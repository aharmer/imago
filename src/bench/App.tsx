import { useEffect, useRef, useState } from 'react';
import { detectEnv, gpuLabel, type EnvInfo } from './env';
import { MODELS, deviceLabel } from './models';
import { Preview, type LoadedImage } from './Preview';
import type { BenchResult, FromWorker, MaskData, MaskOverlay, ModelConfig, Point, Stage, ToWorker } from './protocol';
import { ms, toJson, toMarkdown, verdict, VERDICT_TEXT, type Report } from './report';
import { makeTestImage } from './testImage';

type RowStatus = 'queued' | 'running' | 'done' | 'error' | 'stopped';
interface Row {
  key: string;
  status: RowStatus;
  progress?: string;
  result?: BenchResult;
  overlay?: MaskOverlay;
  error?: string;
}
type Progress = Extract<FromWorker, { type: 'progress' }>;

const MAX_DISPLAY = { width: 960, height: 640 };
const STAGE_TEXT: Record<Stage, string> = {
  loading: 'Loading model',
  image: 'Preparing image',
  encoding: 'Encoding image',
  decoding: 'Timing clicks',
  'full-res mask': 'Full-res mask',
};
const LABEL_KEY = 'imago-bench-label';

const createWorker = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`;

function progressText(p: Progress) {
  let text = STAGE_TEXT[p.stage];
  if (p.totalBytes) text += ` ${mb(p.loadedBytes ?? 0)} / ${mb(p.totalBytes)}`;
  if (p.steps && p.steps > 1) text += ` ${p.step}/${p.steps}`;
  return `${text}…`;
}

async function toOverlay({ pixels, box, score }: MaskData): Promise<MaskOverlay> {
  return { bitmap: await createImageBitmap(pixels), box, score };
}

function unavailableReason(m: ModelConfig, env: EnvInfo | null): string | null {
  if (!env || m.device !== 'webgpu') return null;
  if (!env.gpu.available) return 'WebGPU not available';
  if (m.needsF16 && !env.gpu.f16) return 'GPU lacks fp16 support';
  return null;
}

async function loadImage(file: File): Promise<LoadedImage> {
  const full = await createImageBitmap(file);
  const cssScale = Math.min(1, MAX_DISPLAY.width / full.width, MAX_DISPLAY.height / full.height);
  const pxScale = Math.min(1, cssScale * devicePixelRatio);
  const display = await createImageBitmap(full, {
    resizeWidth: Math.round(full.width * pxScale),
    resizeHeight: Math.round(full.height * pxScale),
    resizeQuality: 'high',
  });
  const loaded = { file, width: full.width, height: full.height, display, cssWidth: Math.round(full.width * cssScale) };
  full.close();
  return loaded;
}

function readLabel() {
  try {
    return localStorage.getItem(LABEL_KEY) ?? '';
  } catch {
    return '';
  }
}

export function App() {
  const [env, setEnv] = useState<EnvInfo | null>(null);
  const [label, setLabel] = useState(readLabel);
  const [threads, setThreads] = useState<number | 'auto'>('auto');
  const [encodeRuns, setEncodeRuns] = useState(3);
  const [decodeRuns, setDecodeRuns] = useState(10);
  const [selected, setSelected] = useState(() => new Set(MODELS.filter((m) => m.defaultOn).map((m) => m.key)));
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [tryKey, setTryKey] = useState<string | null>(null);
  const [tryReady, setTryReady] = useState(false);
  const [tryStatus, setTryStatus] = useState('');
  const [tryOverlay, setTryOverlay] = useState<MaskOverlay | null>(null);
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [notice, setNotice] = useState('');

  const benchWorker = useRef<Worker | null>(null);
  const tryWorker = useRef<Worker | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const stopRequested = useRef(false);

  useEffect(() => {
    detectEnv().then((info) => {
      setEnv(info);
      setSelected((prev) => new Set([...prev].filter((key) => !unavailableReason(MODELS.find((m) => m.key === key)!, info))));
    });
    refreshCacheSize();
    makeTestImage().then(loadImage).then(setImage);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LABEL_KEY, label);
    } catch {
      // Remembering the label is a convenience only.
    }
  }, [label]);

  async function refreshCacheSize() {
    try {
      const estimate = await navigator.storage.estimate();
      setCacheBytes(estimate.usage ?? null);
    } catch {
      setCacheBytes(null);
    }
  }

  const updateRow = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function runOnWorker(worker: Worker, config: ModelConfig, opts: { encodeRuns: number; decodeRuns: number; measureFullRes: boolean }, onProgress: (p: Progress) => void) {
    return new Promise<{ result: BenchResult; overlay: MaskOverlay }>((resolve, reject) => {
      cancel.current = () => reject(new Error('Stopped'));
      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        const msg = event.data;
        if (msg.type === 'progress') onProgress(msg);
        else if (msg.type === 'result') toOverlay(msg.mask).then((overlay) => resolve({ result: msg.result, overlay }), reject);
        else if (msg.type === 'error') reject(new Error(msg.message));
      };
      worker.onerror = (event) => {
        event.preventDefault();
        reject(new Error(event.message || 'The model crashed, most likely by running out of memory.'));
      };
      const message: ToWorker = {
        type: 'benchmark',
        config,
        numThreads: threads,
        image: image!.file,
        points,
        display: { width: image!.display.width, height: image!.display.height },
        ...opts,
      };
      worker.postMessage(message);
    });
  }

  function stopTry() {
    tryWorker.current?.terminate();
    tryWorker.current = null;
    setTryKey(null);
    setTryReady(false);
    setTryOverlay(null);
    setTryStatus('');
  }

  async function runBenchmark() {
    if (!image) return;
    stopTry();
    const queue = MODELS.filter((m) => selected.has(m.key) && !unavailableReason(m, env));
    setRows(queue.map((m) => ({ key: m.key, status: 'queued' })));
    setViewKey(null);
    setRunning(true);
    stopRequested.current = false;

    for (const config of queue) {
      if (stopRequested.current) {
        updateRow(config.key, { status: 'stopped' });
        continue;
      }
      updateRow(config.key, { status: 'running', progress: 'Starting…' });
      const worker = createWorker();
      benchWorker.current = worker;
      try {
        const { result, overlay } = await runOnWorker(worker, config, { encodeRuns, decodeRuns, measureFullRes: true }, (p) =>
          updateRow(config.key, { progress: progressText(p) }),
        );
        updateRow(config.key, { status: 'done', result, overlay, progress: undefined });
        setViewKey(config.key);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateRow(config.key, { status: stopRequested.current ? 'stopped' : 'error', error: message, progress: undefined });
      } finally {
        worker.terminate();
        benchWorker.current = null;
        cancel.current = null;
      }
    }
    setRunning(false);
    refreshCacheSize();
  }

  function stopBenchmark() {
    stopRequested.current = true;
    benchWorker.current?.terminate();
    cancel.current?.();
  }

  async function startTry(config: ModelConfig) {
    if (!image) return;
    stopTry();
    const worker = createWorker();
    tryWorker.current = worker;
    setTryKey(config.key);
    setTryStatus('Starting…');
    try {
      const { result, overlay } = await runOnWorker(worker, config, { encodeRuns: 1, decodeRuns: 1, measureFullRes: false }, (p) => setTryStatus(progressText(p)));
      if (tryWorker.current !== worker) return;
      setTryOverlay(points.length ? overlay : null);
      setTryReady(true);
      setTryStatus(`Image encoded in ${ms(result.encodeFirstMs)}. Click to add points.`);
      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        const msg = event.data;
        if (msg.type === 'decoded') {
          toOverlay(msg.mask).then(setTryOverlay);
          setTryStatus(`Mask in ${ms(msg.ms)} · score ${msg.mask.score.toFixed(2)}`);
        } else if (msg.type === 'error') {
          setTryStatus(`Error: ${msg.message}`);
        }
      };
    } catch (err) {
      if (tryWorker.current === worker) setTryStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      cancel.current = null;
    }
  }

  function handlePoint(point: Point) {
    if (tryKey && tryReady && image) {
      const next = [...points, point];
      setPoints(next);
      const message: ToWorker = { type: 'decode', points: next, display: { width: image.display.width, height: image.display.height } };
      tryWorker.current?.postMessage(message);
    } else if (!running && !tryKey) {
      setPoints(point.positive ? [point] : [...points, point]);
    }
  }

  function clearPoints() {
    setPoints([]);
    setTryOverlay(null);
  }

  async function chooseImage(file: File | undefined | null) {
    if (!file) return;
    setImageError(null);
    try {
      const loaded = await loadImage(file);
      stopTry();
      setImage(loaded);
      setPoints([]);
      setRows([]);
    } catch (err) {
      setImageError(`Couldn't open that image: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function clearModelCache() {
    for (const key of await caches.keys()) {
      if (key.startsWith('transformers')) await caches.delete(key);
    }
    await refreshCacheSize();
    flash('Downloaded models removed.');
  }

  function flash(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(''), 3000);
  }

  const report: Report | null =
    env && image
      ? {
          label,
          date: new Date().toISOString(),
          env,
          image: { name: image.file.name, width: image.width, height: image.height, bytes: image.file.size },
          settings: { threads, encodeRuns, decodeRuns },
          results: rows.filter((r) => r.result).map((r) => r.result!),
        }
      : null;

  async function copyMarkdown() {
    if (!report) return;
    await navigator.clipboard.writeText(toMarkdown(report));
    flash('Results copied — paste them into an email, Teams or a GitHub issue.');
  }

  function downloadJson() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([toJson(report)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `imago-benchmark-${(label || 'results').replace(/[^\w-]+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const shownOverlay = tryKey ? tryOverlay : (rows.find((r) => r.key === viewKey)?.overlay ?? null);
  const selectedDownload = MODELS.filter((m) => selected.has(m.key) && !unavailableReason(m, env)).reduce((sum, m) => sum + m.downloadMB, 0);
  const hasResults = rows.some((r) => r.result);
  const isChromium = env ? /Chrome|Edge|Chromium/i.test(env.browser) || /Chrome\//.test(env.userAgent) : true;

  return (
    <main>
      <header>
        <p className="eyebrow">imago · phase 0</p>
        <h1>Segmentation benchmark</h1>
        <p className="lede">
          Measures how fast one-click segmentation models run in this browser on this computer, so we can pick the default model for imago.
          Your image never leaves this machine. Models download once from Hugging Face and are cached by the browser.
        </p>
      </header>

      {!isChromium && <p className="warn">imago targets Chrome and Microsoft Edge. Results in other browsers may be missing GPU models or be slower.</p>}
      {env && !env.crossOriginIsolated && <p className="warn">This page isn't cross-origin isolated, so CPU models are limited to a single thread and will look slower than they are.</p>}

      <section className="card">
        <h2>1 · This computer</h2>
        {env ? (
          <dl className="env">
            <dt>Browser</dt>
            <dd>{env.browser} on {env.platform}</dd>
            <dt>CPU threads</dt>
            <dd>{env.cpuThreads}</dd>
            <dt>Memory</dt>
            <dd>{env.deviceMemoryGB == null ? 'Unknown' : `${env.deviceMemoryGB >= 8 ? '8 GB or more' : `${env.deviceMemoryGB} GB`}`}</dd>
            <dt>GPU (WebGPU)</dt>
            <dd>
              {gpuLabel(env.gpu)}
              {env.gpu.available && <span className="muted"> · fp16 {env.gpu.f16 ? 'supported' : 'not supported'}</span>}
            </dd>
          </dl>
        ) : (
          <p className="muted">Detecting…</p>
        )}
        <div className="fields">
          <label>
            Name this machine
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Lab PC 3, or my laptop" />
          </label>
          <label>
            CPU inference threads
            <select value={String(threads)} onChange={(e) => setThreads(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}>
              <option value="auto">Auto{env ? ` (${env.autoThreads})` : ''}</option>
              {[1, 2, 4, 6, 8, 12, 16].filter((n) => !env || n <= env.cpuThreads).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="card">
        <h2>2 · Test image</h2>
        <p className="muted">
          For realistic numbers, use one of your own typical images. A synthetic 12 MP specimen photo is loaded by default.
          Click on the object to segment; right-click or Shift-click marks an area to exclude. With no point, the image centre is used.
        </p>
        <div className="toolbar">
          <label className="button">
            Choose image…
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => chooseImage(e.target.files?.[0])} />
          </label>
          <button onClick={() => makeTestImage().then(chooseImage)}>Use synthetic image</button>
          <button onClick={clearPoints} disabled={points.length === 0}>Clear points</button>
          {image && (
            <span className="muted">
              {image.file.name} · {image.width}×{image.height} · {(image.width * image.height / 1e6).toFixed(1)} MP · {mb(image.file.size)}
            </span>
          )}
        </div>
        {imageError && <p className="error">{imageError}</p>}
        {tryKey && (
          <p className="try">
            <strong>Trying {MODELS.find((m) => m.key === tryKey)!.family} ({deviceLabel(MODELS.find((m) => m.key === tryKey)!)}):</strong> {tryStatus}{' '}
            <button className="link" onClick={stopTry}>Done</button>
          </p>
        )}
        {image ? <Preview image={image} overlay={shownOverlay} points={points} onPoint={handlePoint} /> : <p className="muted">Preparing image…</p>}
      </section>

      <section className="card">
        <h2>3 · Models</h2>
        <table className="models">
          <thead>
            <tr>
              <th />
              <th>Model</th>
              <th>Runs on</th>
              <th>Precision</th>
              <th className="num">Download</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {MODELS.map((m) => {
              const reason = unavailableReason(m, env);
              return (
                <tr key={m.key} className={reason ? 'disabled' : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Include ${m.family} ${deviceLabel(m)} ${m.dtype}`}
                      disabled={Boolean(reason) || running}
                      checked={selected.has(m.key) && !reason}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(m.key);
                          else next.delete(m.key);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td>{m.family}</td>
                  <td>{deviceLabel(m)}</td>
                  <td>{m.dtype}</td>
                  <td className="num">{m.downloadMB} MB</td>
                  <td className="muted small">{reason ?? m.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="fields">
          <label>
            Encodes per model
            <select value={encodeRuns} onChange={(e) => setEncodeRuns(Number(e.target.value))} disabled={running}>
              {[2, 3, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label>
            Clicks per model
            <select value={decodeRuns} onChange={(e) => setDecodeRuns(Number(e.target.value))} disabled={running}>
              {[5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <div className="toolbar">
          {running ? (
            <button className="primary" onClick={stopBenchmark}>Stop</button>
          ) : (
            <button className="primary" onClick={runBenchmark} disabled={!image || !env || selected.size === 0}>
              Run benchmark
            </button>
          )}
          <span className="muted">Up to {selectedDownload} MB to download on first run.</span>
          <span className="spacer" />
          <button onClick={clearModelCache} disabled={running}>Remove downloaded models</button>
          {cacheBytes != null && <span className="muted small">Site storage: {mb(cacheBytes)}</span>}
        </div>
      </section>

      {rows.length > 0 && (
        <section className="card">
          <h2>4 · Results</h2>
          <div className="scroll">
            <table className="results">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Load</th>
                  <th title="First encode includes warm-up (e.g. compiling GPU shaders)">Encode (first)</th>
                  <th title="Median of the later encodes: the time per image in normal use">Encode (typical)</th>
                  <th title="Median time from click to mask">Click</th>
                  <th title="Upsampling the chosen mask to full image resolution in JavaScript">Full-res mask</th>
                  <th>Verdict</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const m = MODELS.find((x) => x.key === row.key)!;
                  const r = row.result;
                  return (
                    <tr key={row.key} className={viewKey === row.key && !tryKey ? 'viewing' : undefined}>
                      <td>
                        {m.family} <span className="muted">· {deviceLabel(m)} · {m.dtype}</span>
                      </td>
                      {r ? (
                        <>
                          <td>{ms(r.loadMs)}{r.cachedBeforeRun && <span className="muted small"> cached</span>}</td>
                          <td>{ms(r.encodeFirstMs)}</td>
                          <td>{ms(r.encodeMedianMs)}</td>
                          <td>{ms(r.decodeMedianMs ?? r.decodeFirstMs)}</td>
                          <td>{ms(r.fullResMaskMs)}</td>
                          <td><span className={`verdict ${verdict(r)}`}>{VERDICT_TEXT[verdict(r)]}</span></td>
                          <td className="actions">
                            <button className="link" onClick={() => { stopTry(); setViewKey(row.key); }}>Mask</button>
                            <button className="link" onClick={() => startTry(m)} disabled={running}>Try it</button>
                          </td>
                        </>
                      ) : (
                        <td colSpan={7} className={row.status === 'error' ? 'error' : 'muted'}>
                          {row.status === 'queued' && 'Waiting…'}
                          {row.status === 'running' && row.progress}
                          {row.status === 'stopped' && 'Stopped'}
                          {row.status === 'error' && row.error}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            <strong>Smooth:</strong> ≤2 s per image and ≤200 ms per click. <strong>Usable:</strong> ≤6 s per image (imago encodes the next images in
            the background) and ≤500 ms per click. Compare mask quality with <em>Mask</em>, or click around with <em>Try it</em>.
          </p>
          <div className="toolbar">
            <button className="primary" onClick={copyMarkdown} disabled={!hasResults || running}>Copy results</button>
            <button onClick={downloadJson} disabled={!hasResults || running}>Download JSON</button>
            {notice && <span className="notice">{notice}</span>}
          </div>
        </section>
      )}
    </main>
  );
}
