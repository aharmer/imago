import { useEffect, useState } from 'react';
import { planExport, runExport, type ExportOptions, type ExportPlan, type ExportSummary } from '../export/exporter';
import { FORMAT_LABEL, FORMAT_NOTE, type Format } from '../export/formats';
import { useStore } from '../store';
import { Modal } from './Modal';

const FORMATS: Format[] = ['yolo-detect', 'yolo-segment', 'yolo-classify', 'coco', 'voc', 'csv'];
/** Leave at least a tenth of the images for training. */
const MAX_HELD_BACK = 90;

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const [options, setOptions] = useState<ExportOptions>({
    format: 'yolo-detect',
    includeImages: true,
    split: { val: 20, test: 0 },
    include: 'annotated',
    classifySource: 'crops',
  });
  const [plan, setPlan] = useState<ExportPlan | null>(null);
  const [phase, setPhase] = useState<'options' | 'running' | 'done'>('options');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<(ExportSummary & { folder: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Work out what would be exported (reads the saved annotation files).
  useEffect(() => {
    let cancelled = false;
    setPlan(null);
    (async () => {
      try {
        await useStore.getState().flushSaves();
        const { folder, project, images } = useStore.getState();
        const result = await planExport(folder!, project, images, options);
        if (!cancelled) setPlan(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only `include` changes which images and annotations are in the plan.
  }, [options.include]);

  async function start() {
    if (!plan) return;
    setError(null);
    let target: FileSystemDirectoryHandle;
    try {
      target = await window.showDirectoryPicker({ id: 'imagoLabel-export', mode: 'readwrite' });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) setError(err instanceof Error ? err.message : String(err));
      return;
    }
    for await (const _entry of target.values()) {
      if (!window.confirm(`“${target.name}” already contains files. Files with the same names will be replaced. Continue?`)) return;
      break;
    }
    setPhase('running');
    try {
      const { folder, images } = useStore.getState();
      const result = await runExport(target, folder!, images, plan, options, (done, total) => setProgress({ done, total }));
      setSummary({ ...result, folder: target.name });
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('options');
    }
  }

  const set = (patch: Partial<ExportOptions>) => setOptions((o) => ({ ...o, ...patch }));
  /** Move one slider, pushing the other down if together they'd leave too little for training. */
  const setSplit = (which: 'val' | 'test', value: number) =>
    setOptions((o) => {
      const other = which === 'val' ? o.split.test : o.split.val;
      const capped = Math.min(value, MAX_HELD_BACK);
      const otherCapped = Math.min(other, MAX_HELD_BACK - capped);
      return { ...o, split: which === 'val' ? { val: capped, test: otherCapped } : { val: otherCapped, test: capped } };
    });
  const trainPercent = 100 - options.split.val - options.split.test;

  return (
    <Modal title="Export annotations" onClose={onClose}>
      {phase === 'done' && summary ? (
        <>
          <p className="ok">
            Exported <strong>{summary.annotations}</strong> annotations for <strong>{summary.images}</strong> images into “{summary.folder}” ({summary.filesWritten} files).
          </p>
          <p className="small muted">
            Training {summary.counts.train} · validation {summary.counts.val} · test {summary.counts.test} images.
          </p>
          {plan && plan.unlabelled > 0 && <p className="warn small">{plan.unlabelled} annotations had no class and were left out.</p>}
          {summary.mixedClass.length > 0 && (
            <p className="warn small">
              {summary.mixedClass.length} image{summary.mixedClass.length === 1 ? ' holds' : 's hold'} more than one class and {summary.mixedClass.length === 1 ? 'was' : 'were'} left out. Export cropped
              annotations instead to include them.
            </p>
          )}
          {summary.rotated.length > 0 && (
            <p className="warn small">
              {summary.rotated.length} image{summary.rotated.length === 1 ? '' : 's'} (e.g. {summary.rotated[0]}) carry an EXIF rotation. imagoLabel annotates them upright; check that your training code rotates them too.
            </p>
          )}
          {options.format.startsWith('yolo') && (
            <p className="small">
              Train with:{' '}
              <code>
                {options.format === 'yolo-classify'
                  ? 'yolo classify train data=. model=yolo11n-cls.pt'
                  : `yolo ${options.format === 'yolo-segment' ? 'segment' : 'detect'} train data=data.yaml model=${options.format === 'yolo-segment' ? 'yolo11n-seg.pt' : 'yolo11n.pt'}`}
              </code>
            </p>
          )}
          <div className="modal-actions">
            <button className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <fieldset disabled={phase === 'running'}>
            <legend>Format</legend>
            {FORMATS.map((format) => (
              <label key={format} className="choice">
                <input type="radio" name="format" checked={options.format === format} onChange={() => set({ format })} />
                <span>
                  <strong>{FORMAT_LABEL[format]}</strong>
                  <span className="muted small"> {FORMAT_NOTE[format]}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset disabled={phase === 'running'}>
            <legend>Options</legend>
            {options.format === 'yolo-classify' ? (
              <label className="field-row">
                What becomes one training image
                <select value={options.classifySource} onChange={(e) => set({ classifySource: e.target.value as ExportOptions['classifySource'] })}>
                  <option value="crops">Each annotation, cropped out</option>
                  <option value="images">The whole image (single-class images only)</option>
                </select>
              </label>
            ) : (
              <label className="choice">
                <input type="checkbox" checked={options.includeImages} onChange={(e) => set({ includeImages: e.target.checked })} />
                <span>
                  Copy the images too <span className="muted small">— makes the export ready to train on, but duplicates the image files</span>
                </span>
              </label>
            )}

            <div className="split">
              <div className="split-bar" aria-hidden="true">
                <span className="split-train" style={{ width: `${trainPercent}%` }} />
                <span className="split-val" style={{ width: `${options.split.val}%` }} />
                <span className="split-test" style={{ width: `${options.split.test}%` }} />
              </div>
              <p className="small">
                <strong>{trainPercent}%</strong> training · <strong>{options.split.val}%</strong> validation · <strong>{options.split.test}%</strong> test
                {plan && plan.docs.length > 0 && (
                  <span className="muted">
                    {' '}
                    ≈ {Math.round((plan.docs.length * trainPercent) / 100)} / {Math.round((plan.docs.length * options.split.val) / 100)} /{' '}
                    {Math.round((plan.docs.length * options.split.test) / 100)} images
                  </span>
                )}
              </p>
              <label className="slider">
                <span>Validation</span>
                <input
                  type="range"
                  min={0}
                  max={MAX_HELD_BACK}
                  value={options.split.val}
                  onChange={(e) => setSplit('val', Number(e.target.value))}
                  aria-label="Validation percentage"
                />
                <output>{options.split.val}%</output>
              </label>
              <label className="slider">
                <span>Test</span>
                <input type="range" min={0} max={MAX_HELD_BACK} value={options.split.test} onChange={(e) => setSplit('test', Number(e.target.value))} aria-label="Test percentage" />
                <output>{options.split.test}%</output>
              </label>
            </div>

            <label className="field-row">
              Images to include
              <select value={options.include} onChange={(e) => set({ include: e.target.value as ExportOptions['include'] })}>
                <option value="annotated">Every annotated image</option>
                <option value="done">Only images marked done</option>
              </select>
            </label>
          </fieldset>

          <p className="summary">
            {plan ? (
              <>
                <strong>{plan.docs.length}</strong> images · <strong>{plan.annotations}</strong> annotations · {plan.classes.length} classes
                {plan.unlabelled > 0 && <span className="warn small"> · {plan.unlabelled} without a class will be left out</span>}
                {plan.excluded > 0 && <span className="muted small"> · {plan.excluded} images not included</span>}
              </>
            ) : (
              <span className="muted">Checking what can be exported…</span>
            )}
          </p>

          {phase === 'running' && (
            <p className="summary">
              Writing {progress.done} / {progress.total} images…
            </p>
          )}
          {error && <p className="error">{error}</p>}

          <div className="modal-actions">
            <button onClick={onClose} disabled={phase === 'running'}>
              Cancel
            </button>
            <button className="primary" onClick={start} disabled={!plan || plan.docs.length === 0 || phase === 'running'}>
              Choose folder and export…
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
