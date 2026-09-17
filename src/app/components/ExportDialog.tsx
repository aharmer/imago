import { useEffect, useState } from 'react';
import { planExport, runExport, type ExportOptions, type ExportPlan, type ExportSummary } from '../export/exporter';
import { FORMAT_LABEL, FORMAT_NOTE, type Format } from '../export/formats';
import { useStore } from '../store';
import { Modal } from './Modal';

const FORMATS: Format[] = ['yolo-detect', 'yolo-segment', 'coco', 'voc', 'csv'];

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const [options, setOptions] = useState<ExportOptions>({ format: 'yolo-detect', includeImages: true, valPercent: 20, include: 'annotated' });
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

  return (
    <Modal title="Export annotations" onClose={onClose}>
      {phase === 'done' && summary ? (
        <>
          <p className="ok">
            Exported <strong>{summary.annotations}</strong> annotations for <strong>{summary.images}</strong> images into “{summary.folder}” ({summary.filesWritten} files).
          </p>
          {plan && plan.unlabelled > 0 && <p className="warn small">{plan.unlabelled} annotations had no class and were left out.</p>}
          {summary.rotated.length > 0 && (
            <p className="warn small">
              {summary.rotated.length} image{summary.rotated.length === 1 ? '' : 's'} (e.g. {summary.rotated[0]}) carry an EXIF rotation. imagoLabel annotates them upright; check that your training code rotates them too.
            </p>
          )}
          {options.format.startsWith('yolo') && (
            <p className="small">
              Train with: <code>yolo {options.format === 'yolo-segment' ? 'segment' : 'detect'} train data=data.yaml model={options.format === 'yolo-segment' ? 'yolo11n-seg.pt' : 'yolo11n.pt'}</code>
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
            <label className="choice">
              <input type="checkbox" checked={options.includeImages} onChange={(e) => set({ includeImages: e.target.checked })} />
              <span>
                Copy the images too <span className="muted small">— makes the export ready to train on, but duplicates the image files</span>
              </span>
            </label>
            <div className="fields">
              <label>
                Validation split
                <select value={options.valPercent} onChange={(e) => set({ valPercent: Number(e.target.value) })}>
                  <option value={0}>None (all training)</option>
                  <option value={10}>10% validation</option>
                  <option value={20}>20% validation</option>
                  <option value={30}>30% validation</option>
                </select>
              </label>
              <label>
                Images to include
                <select value={options.include} onChange={(e) => set({ include: e.target.value as ExportOptions['include'] })}>
                  <option value="annotated">Every annotated image</option>
                  <option value="done">Only images marked done</option>
                </select>
              </label>
            </div>
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
