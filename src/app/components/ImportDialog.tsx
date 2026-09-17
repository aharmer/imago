import { useState } from 'react';
import { previewCoco, previewYolo, type ImportPreview } from '../export/importer';
import { useStore } from '../store';
import { Modal } from './Modal';

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<{ images: number; annotations: number } | null>(null);

  async function pick(kind: 'coco' | 'yolo') {
    setError(null);
    try {
      const { folder, images, project } = useStore.getState();
      await useStore.getState().flushSaves();
      if (kind === 'coco') {
        const [handle] = await window.showOpenFilePicker({
          id: 'imagoLabel-import',
          types: [{ description: 'COCO JSON', accept: { 'application/json': ['.json'] } }],
        });
        setBusy('Reading annotations…');
        setPreview(await previewCoco(await handle.getFile(), folder!, images, project.classes, (done, total) => setProgress({ done, total })));
      } else {
        const dir = await window.showDirectoryPicker({ id: 'imagoLabel-import-yolo', mode: 'read' });
        setBusy('Reading label files…');
        setPreview(await previewYolo(dir, folder!, images, project.classes, (done, total) => setProgress({ done, total })));
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!preview) return;
    setBusy('Saving…');
    try {
      const overwriting = new Set(preview.overwriting);
      const docs = replace ? preview.docs : preview.docs.filter((d) => !overwriting.has(d.image.name));
      await useStore.getState().applyImport(docs, preview.newClasses);
      setImported({ images: docs.length, annotations: docs.reduce((sum, d) => sum + d.annotations.length, 0) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title="Import annotations" onClose={onClose}>
      {imported ? (
        <>
          <p className="ok">
            Imported <strong>{imported.annotations}</strong> annotations across <strong>{imported.images}</strong> images.
          </p>
          <div className="modal-actions">
            <button className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : !preview ? (
        <>
          <p className="muted small">
            Annotations are matched to the images in this folder by file name. Classes that already exist are reused; new ones are added.
          </p>
          <div className="modal-actions start">
            <button onClick={() => pick('coco')} disabled={Boolean(busy)}>
              Choose a COCO JSON file…
            </button>
            <button onClick={() => pick('yolo')} disabled={Boolean(busy)}>
              Choose a folder of YOLO labels…
            </button>
          </div>
          {busy && (
            <p className="summary">
              {busy} {progress.total > 0 && `${progress.done} / ${progress.total}`}
            </p>
          )}
          {error && <p className="error">{error}</p>}
        </>
      ) : (
        <>
          <p className="summary">
            From <strong>{preview.source}</strong>: <strong>{preview.annotations}</strong> annotations across <strong>{preview.docs.length}</strong> images.
          </p>
          <p className="small">
            Classes: {preview.classNames.join(', ') || 'none named'}
            {preview.newClasses.length > 0 && <span className="muted"> ({preview.newClasses.length} new)</span>}
          </p>
          {preview.unmatched.length > 0 && (
            <p className="warn small">
              {preview.unmatched.length} entries have no matching image in this folder (e.g. {preview.unmatched.slice(0, 3).join(', ')}).
            </p>
          )}
          {preview.overwriting.length > 0 && (
            <label className="choice">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              <span>
                Replace the annotations already in imagoLabel on {preview.overwriting.length} image{preview.overwriting.length === 1 ? '' : 's'}
                <span className="muted small"> — otherwise those images are left as they are</span>
              </span>
            </label>
          )}
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button onClick={() => setPreview(null)} disabled={Boolean(busy)}>
              Back
            </button>
            <button className="primary" onClick={apply} disabled={Boolean(busy) || preview.docs.length === 0}>
              Import
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
