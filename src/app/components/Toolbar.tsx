import { useModelStatus } from '../segment/segmenter';
import { useStore, type Tool } from '../store';
import { STATUS_LABEL } from '../project/types';

const TOOLS: Array<{ tool: Tool; label: string; key: string; title: string }> = [
  { tool: 'segment', label: 'Segment', key: 'S', title: 'Click an object to outline it automatically, or drag a box around it. Click the outline to add an area, right-click to remove one' },
  { tool: 'select', label: 'Select', key: 'V', title: 'Select, move and edit shapes; drag empty space to pan' },
  { tool: 'box', label: 'Box', key: 'B', title: 'Drag to draw a box' },
  { tool: 'polygon', label: 'Polygon', key: 'P', title: 'Click to add points; Enter or click the first point to finish' },
];

function ModelBadge() {
  const status = useModelStatus((s) => s.status);
  if (status.kind === 'idle') return null;
  if (status.kind === 'loading') {
    const pct = status.total ? ` ${Math.round((status.loaded / status.total) * 100)}%` : '';
    return <span className="model-badge loading" title="Downloading the segmentation model. This only happens once.">Loading AI{pct}</span>;
  }
  if (status.kind === 'error') return <span className="model-badge error" title={status.message}>AI unavailable</span>;
  return (
    <span className="model-badge ready" title={status.device === 'webgpu' ? 'Segmentation is running on your graphics card' : 'Segmentation is running on the CPU'}>
      AI · {status.device === 'webgpu' ? 'GPU' : 'CPU'}
    </span>
  );
}

function SaveIndicator() {
  const saveState = useStore((s) => s.saveState);
  if (saveState.kind === 'error') {
    return (
      <span className="save error" title={saveState.message}>
        Not saved — retrying
      </span>
    );
  }
  return <span className={`save ${saveState.kind}`}>{saveState.kind === 'pending' ? 'Saving…' : 'All changes saved'}</span>;
}

export function Toolbar() {
  const folderName = useStore((s) => s.folder?.name);
  const tool = useStore((s) => s.tool);
  const images = useStore((s) => s.images);
  const currentName = useStore((s) => s.currentName);
  const status = useStore((s) => s.doc?.status);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const { setTool, undo, redo, goRelative, setStatus, closeFolder } = useStore.getState();
  const index = images.findIndex((i) => i.name === currentName);

  return (
    <header className="toolbar">
      <div className="toolbar-group">
        <span className="brand small">imagoLabel</span>
        <span className="folder-name" title={folderName}>
          {folderName}
        </span>
      </div>

      <div className="toolbar-group" role="toolbar" aria-label="Tools">
        {TOOLS.map((t) => (
          <button key={t.tool} className={`tool${tool === t.tool ? ' active' : ''}`} onClick={() => setTool(t.tool)} title={`${t.title} (${t.key})`} aria-pressed={tool === t.tool}>
            {t.label} <kbd>{t.key}</kbd>
          </button>
        ))}
        <ModelBadge />
        <span className="divider" />
        <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
      </div>

      <div className="toolbar-group">
        <button onClick={() => goRelative(-1)} disabled={index <= 0} title="Previous image (←)" aria-label="Previous image">
          ‹
        </button>
        <span className="image-position" title={currentName ?? undefined}>
          {index + 1} / {images.length}
        </span>
        <button onClick={() => goRelative(1)} disabled={index >= images.length - 1} title="Next image (→)" aria-label="Next image">
          ›
        </button>
        {status && <span className={`status-pill ${status}`}>{STATUS_LABEL[status]}</span>}
        {status === 'done' || status === 'skipped' ? (
          <button onClick={() => setStatus('in-progress')}>Reopen</button>
        ) : (
          <>
            <button
              className="primary"
              onClick={() => {
                setStatus('done');
                void goRelative(1);
              }}
              title="Mark this image done and go to the next (Enter)"
            >
              Done <kbd>↵</kbd>
            </button>
            <button onClick={() => setStatus('skipped')} title="Skip this image (it won't be exported)">
              Skip
            </button>
          </>
        )}
      </div>

      <div className="toolbar-group">
        <SaveIndicator />
        <button onClick={() => void closeFolder()} title="Save and close this folder">
          Close
        </button>
      </div>
    </header>
  );
}
