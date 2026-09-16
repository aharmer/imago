export type Device = 'wasm' | 'webgpu';

export type Dtype = 'fp32' | 'fp16' | 'q8' | 'q4f16';

export interface ModelConfig {
  key: string;
  family: string;
  repo: string;
  /** Where the image encoder runs. The small mask decoder always runs on the CPU. */
  device: Device;
  dtype: Dtype;
  decoderDtype: Dtype;
  downloadMB: number;
  defaultOn: boolean;
  /** fp16 weights on WebGPU need the adapter's shader-f16 feature. */
  needsF16?: boolean;
  note?: string;
}

/** Axis-aligned box in original image pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
  /** true = include this area, false = exclude it. */
  positive: boolean;
}

/** Mask as sent by the worker: raw pixels, because an ImageBitmap made in a worker dies with it. */
export interface MaskData {
  pixels: ImageData;
  box: Box | null;
  score: number;
}

/** Mask ready to draw on the page. */
export interface MaskOverlay {
  bitmap: ImageBitmap;
  box: Box | null;
  score: number;
}

export interface BenchResult {
  key: string;
  numThreads: number | 'auto';
  cachedBeforeRun: boolean;
  loadMs: number;
  imageWidth: number;
  imageHeight: number;
  imageDecodeMs: number;
  imagePrepMs: number;
  encodeFirstMs: number;
  encodeMedianMs: number | null;
  decodeFirstMs: number;
  decodeMedianMs: number | null;
  fullResMaskMs: number | null;
  score: number;
}

export type ToWorker =
  | {
      type: 'benchmark';
      config: ModelConfig;
      numThreads: number | 'auto';
      image: Blob;
      points: Point[];
      encodeRuns: number;
      decodeRuns: number;
      measureFullRes: boolean;
      display: { width: number; height: number };
    }
  | { type: 'decode'; points: Point[]; display: { width: number; height: number } };

export type Stage = 'loading' | 'image' | 'encoding' | 'decoding' | 'full-res mask';

export type FromWorker =
  | { type: 'progress'; stage: Stage; loadedBytes?: number; totalBytes?: number; step?: number; steps?: number }
  | { type: 'result'; result: BenchResult; mask: MaskData }
  | { type: 'decoded'; mask: MaskData; ms: number }
  | { type: 'error'; message: string };
