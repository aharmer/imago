// Runs one SAM model off the main thread: load → prepare image → encode → decode clicks.
// The page creates a fresh worker per benchmark so each model starts with clean memory.
import { AutoModel, AutoProcessor, RawImage, Tensor, env } from '@huggingface/transformers';
import type { BenchResult, Box, FromWorker, MaskData, ModelConfig, Point, ToWorker } from './protocol';

interface WorkerScope {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;
const post = (message: FromWorker, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

// Serve ONNX Runtime's WASM from our own origin (copied by scripts/copy-ort.mjs) rather than a CDN.
env.allowLocalModels = false;
const onnx = env.backends.onnx as { wasm: { wasmPaths?: unknown; numThreads?: number } };
const ortBase = new URL(`${import.meta.env.BASE_URL}ort/`, self.location.origin).href;
const ortVariant = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
  ? 'ort-wasm-simd-threaded'
  : 'ort-wasm-simd-threaded.asyncify';
onnx.wasm.wasmPaths = { mjs: `${ortBase}${ortVariant}.mjs`, wasm: `${ortBase}${ortVariant}.wasm` };

const DTYPE_SUFFIX: Record<ModelConfig['dtype'], string> = { fp32: '', fp16: '_fp16', q8: '_quantized', q4f16: '_q4f16' };
const MAX_FULL_RES_PIXELS = 120_000_000;

// Transformers.js model and processor types are too loose to be useful here.
let model: any = null;
let processor: any = null;
let current: {
  embeddings: Record<string, Tensor>;
  inputs: any;
  scale: number;
  width: number;
  height: number;
} | null = null;

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const value = await fn();
  return [value, performance.now() - start];
}

async function isCached(config: ModelConfig) {
  try {
    const cache = await caches.open(env.cacheKey ?? 'transformers-cache');
    const url = `https://huggingface.co/${config.repo}/resolve/main/onnx/vision_encoder${DTYPE_SUFFIX[config.dtype]}.onnx`;
    return Boolean(await cache.match(url));
  } catch {
    return false;
  }
}

async function loadModel(config: ModelConfig) {
  const files = new Map<string, { loaded: number; total: number }>();
  let lastPost = 0;
  const progress_callback = (p: any) => {
    if (p.status !== 'progress' || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    const now = performance.now();
    if (now - lastPost < 150) return;
    lastPost = now;
    let loadedBytes = 0;
    let totalBytes = 0;
    for (const f of files.values()) {
      loadedBytes += f.loaded;
      totalBytes += f.total;
    }
    post({ type: 'progress', stage: 'loading', loadedBytes, totalBytes });
  };
  processor = await AutoProcessor.from_pretrained(config.repo, { progress_callback });
  model = await AutoModel.from_pretrained(config.repo, {
    device: { vision_encoder: config.device, prompt_encoder_mask_decoder: 'wasm' },
    dtype: { vision_encoder: config.dtype, prompt_encoder_mask_decoder: config.decoderDtype },
    progress_callback,
  });
}

/** Decode the image and downscale it natively to ≤1024 px before handing it to the model's processor. */
async function prepareImage(blob: Blob) {
  const [full, decodeMs] = await timed(() => createImageBitmap(blob));
  const [prepared, prepMs] = await timed(async () => {
    const { width, height } = full;
    const scale = Math.min(1, 1024 / Math.max(width, height));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const small = scale < 1 ? await createImageBitmap(full, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }) : full;
    const ctx = new OffscreenCanvas(w, h).getContext('2d')!;
    ctx.drawImage(small, 0, 0);
    if (small !== full) small.close();
    full.close();
    const raw = new RawImage(ctx.getImageData(0, 0, w, h).data, w, h, 4).rgb();
    const inputs = await processor(raw);
    return { inputs, scale, width, height };
  });
  return { ...prepared, decodeMs, prepMs };
}

async function runDecoder(points: Point[]) {
  if (!current) throw new Error('No image has been encoded yet.');
  const { inputs, scale } = current;
  const scaled = points.map((p) => [p.x * scale, p.y * scale]);
  const input_points = processor.reshape_input_points([[scaled]], inputs.original_sizes, inputs.reshaped_input_sizes);
  const labels = BigInt64Array.from(points.map((p) => (p.positive ? 1n : 0n)));
  const input_labels = new Tensor('int64', labels, [1, 1, points.length]);
  return model({ ...current.embeddings, input_points, input_labels });
}

/** Bilinearly upsample one low-res mask (logits) to outW×outH and threshold at 0. */
function upsampleMask(
  logits: ArrayLike<number>,
  offset: number,
  maskW: number,
  maskH: number,
  cropW: number,
  cropH: number,
  outW: number,
  outH: number,
) {
  const out = new Uint8Array(outW * outH);
  const maxU = Math.max(0, Math.ceil(cropW) - 1);
  const maxV = Math.max(0, Math.ceil(cropH) - 1);
  const x0 = new Int32Array(outW);
  const x1 = new Int32Array(outW);
  const wx = new Float32Array(outW);
  for (let x = 0; x < outW; x++) {
    const u = Math.min(Math.max(((x + 0.5) * cropW) / outW - 0.5, 0), maxU);
    x0[x] = Math.floor(u);
    x1[x] = Math.min(x0[x] + 1, maxU);
    wx[x] = u - x0[x];
  }
  for (let y = 0; y < outH; y++) {
    const v = Math.min(Math.max(((y + 0.5) * cropH) / outH - 0.5, 0), maxV);
    const y0 = Math.floor(v);
    const y1 = Math.min(y0 + 1, maxV, maskH - 1);
    const wy = v - y0;
    const r0 = offset + y0 * maskW;
    const r1 = offset + y1 * maskW;
    const row = y * outW;
    for (let x = 0; x < outW; x++) {
      const top = logits[r0 + x0[x]] * (1 - wx[x]) + logits[r0 + x1[x]] * wx[x];
      const bottom = logits[r1 + x0[x]] * (1 - wx[x]) + logits[r1 + x1[x]] * wx[x];
      if (top * (1 - wy) + bottom * wy > 0) out[row + x] = 1;
    }
  }
  return out;
}

/**
 * SAM masks often include a few stray specks away from the object. They are invisible at a glance
 * but stretch the bounding box, so keep only the region(s) the user actually clicked on — or, when
 * there is no click, the largest one.
 */
function keepClickedRegions(mask: Uint8Array, width: number, height: number, seeds: Array<[number, number]>) {
  const labels = new Int32Array(mask.length).fill(-1);
  const stack = new Int32Array(mask.length);
  const sizes: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] >= 0) continue;
    const label = sizes.length;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    while (top > 0) {
      const p = stack[--top];
      size++;
      const x = p % width;
      const y = (p / width) | 0;
      if (x > 0 && mask[p - 1] && labels[p - 1] < 0) labels[stack[top++] = p - 1] = label;
      if (x < width - 1 && mask[p + 1] && labels[p + 1] < 0) labels[stack[top++] = p + 1] = label;
      if (y > 0 && mask[p - width] && labels[p - width] < 0) labels[stack[top++] = p - width] = label;
      if (y < height - 1 && mask[p + width] && labels[p + width] < 0) labels[stack[top++] = p + width] = label;
    }
    sizes.push(size);
  }
  if (sizes.length <= 1) return;

  const keep = new Set<number>();
  for (const [sx, sy] of seeds) {
    const cx = Math.min(width - 1, Math.max(0, Math.round(sx)));
    const cy = Math.min(height - 1, Math.max(0, Math.round(sy)));
    // A click can land a pixel or two outside the mask edge, so look in a small neighbourhood.
    for (let r = 0; r <= 3 && !keep.size; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const label = labels[y * width + x];
          if (label >= 0) keep.add(label);
        }
      }
    }
  }
  if (keep.size === 0) keep.add(sizes.indexOf(Math.max(...sizes)));
  for (let i = 0; i < mask.length; i++) if (mask[i] && !keep.has(labels[i])) mask[i] = 0;
}

/** Pick the highest-scoring mask and describe where it sits inside the low-res mask grid. */
function bestMask(outputs: any) {
  if (!current) throw new Error('No image has been encoded yet.');
  const scores = outputs.iou_scores.data as ArrayLike<number>;
  const [, , count, maskH, maskW] = outputs.pred_masks.dims as number[];
  let best = 0;
  for (let i = 1; i < count; i++) if (scores[i] > scores[best]) best = i;
  // SAM 1 pads the resized image to a square; SAM 2/3 stretch it, so the mask covers the whole grid.
  const [resizedH, resizedW] = current.inputs.reshaped_input_sizes[0] as [number, number];
  const ip = processor.image_processor;
  const padH = ip.do_pad && ip.pad_size ? ip.pad_size.height : resizedH;
  const padW = ip.do_pad && ip.pad_size ? ip.pad_size.width : resizedW;
  return {
    logits: outputs.pred_masks.data as ArrayLike<number>,
    offset: best * maskH * maskW,
    maskW,
    maskH,
    cropW: (maskW * resizedW) / padW,
    cropH: (maskH * resizedH) / padH,
    score: scores[best],
  };
}

function renderMask(outputs: any, display: { width: number; height: number }, points: Point[]): MaskData {
  const m = bestMask(outputs);
  const { width, height } = display;
  const mask = upsampleMask(m.logits, m.offset, m.maskW, m.maskH, m.cropW, m.cropH, width, height);
  const toDisplay = width / current!.width;
  keepClickedRegions(mask, width, height, points.filter((p) => p.positive).map((p) => [p.x * toDisplay, p.y * toDisplay]));
  const rgba = new Uint8ClampedArray(width * height * 4);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      const i = (y * width + x) * 4;
      rgba[i] = 30;
      rgba[i + 1] = 144;
      rgba[i + 2] = 255;
      rgba[i + 3] = 115;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const sx = current!.width / width;
  const sy = current!.height / height;
  const box: Box | null =
    maxX < 0 ? null : { x: minX * sx, y: minY * sy, width: (maxX - minX + 1) * sx, height: (maxY - minY + 1) * sy };
  return { pixels: new ImageData(rgba, width, height), box, score: m.score };
}

async function benchmark(msg: Extract<ToWorker, { type: 'benchmark' }>) {
  if (msg.numThreads !== 'auto') onnx.wasm.numThreads = msg.numThreads;
  const cachedBeforeRun = await isCached(msg.config);

  post({ type: 'progress', stage: 'loading' });
  const [, loadMs] = await timed(() => loadModel(msg.config));

  post({ type: 'progress', stage: 'image' });
  const image = await prepareImage(msg.image);

  const encodeTimes: number[] = [];
  for (let i = 0; i < msg.encodeRuns; i++) {
    post({ type: 'progress', stage: 'encoding', step: i + 1, steps: msg.encodeRuns });
    const [embeddings, ms] = await timed(() => model.get_image_embeddings(image.inputs));
    current = { embeddings: embeddings as Record<string, Tensor>, inputs: image.inputs, scale: image.scale, width: image.width, height: image.height };
    encodeTimes.push(ms);
  }

  const points = msg.points.length ? msg.points : [{ x: image.width / 2, y: image.height / 2, positive: true }];
  const decodeTimes: number[] = [];
  let outputs: any = null;
  for (let i = 0; i < msg.decodeRuns; i++) {
    post({ type: 'progress', stage: 'decoding', step: i + 1, steps: msg.decodeRuns });
    const [out, ms] = await timed(() => runDecoder(points));
    outputs = out;
    decodeTimes.push(ms);
  }

  let fullResMaskMs: number | null = null;
  if (msg.measureFullRes && image.width * image.height <= MAX_FULL_RES_PIXELS) {
    post({ type: 'progress', stage: 'full-res mask' });
    const m = bestMask(outputs);
    const start = performance.now();
    upsampleMask(m.logits, m.offset, m.maskW, m.maskH, m.cropW, m.cropH, image.width, image.height);
    fullResMaskMs = performance.now() - start;
  }

  const mask = renderMask(outputs, msg.display, points);
  const result: BenchResult = {
    key: msg.config.key,
    numThreads: msg.config.device === 'wasm' ? (onnx.wasm.numThreads ?? msg.numThreads) : msg.numThreads,
    cachedBeforeRun,
    loadMs,
    imageWidth: image.width,
    imageHeight: image.height,
    imageDecodeMs: image.decodeMs,
    imagePrepMs: image.prepMs,
    encodeFirstMs: encodeTimes[0],
    encodeMedianMs: median(encodeTimes.slice(1)),
    decodeFirstMs: decodeTimes[0],
    decodeMedianMs: median(decodeTimes.slice(1)),
    fullResMaskMs,
    score: mask.score,
  };
  post({ type: 'result', result, mask }, [mask.pixels.data.buffer]);
}

async function decode(msg: Extract<ToWorker, { type: 'decode' }>) {
  const [outputs, ms] = await timed(() => runDecoder(msg.points));
  const mask = renderMask(outputs, msg.display, msg.points);
  post({ type: 'decoded', mask, ms }, [mask.pixels.data.buffer]);
}

// Handle messages one at a time so rapid clicks queue rather than overlap.
let queue = Promise.resolve();
scope.onmessage = (event) => {
  const msg = event.data;
  queue = queue.then(async () => {
    try {
      if (msg.type === 'benchmark') await benchmark(msg);
      else await decode(msg);
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });
};
