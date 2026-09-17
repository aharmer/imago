import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type Filter } from '../store';
import { STATUS_LABEL, type ImageStatus } from '../project/types';

const ROW_HEIGHT = 30;
const OVERSCAN = 10;
const STATUSES: ImageStatus[] = ['todo', 'in-progress', 'done', 'skipped'];

export function ImageList() {
  const images = useStore((s) => s.images);
  const summaries = useStore((s) => s.project.images);
  const currentName = useStore((s) => s.currentName);
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const goTo = useStore((s) => s.goTo);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);

  const counts = useMemo(() => {
    const c: Record<ImageStatus, number> = { todo: 0, 'in-progress': 0, done: 0, skipped: 0 };
    for (const image of images) c[summaries[image.name]?.status ?? 'todo']++;
    return c;
  }, [images, summaries]);

  const visible = useMemo(
    () => (filter === 'all' ? images : images.filter((i) => (summaries[i.name]?.status ?? 'todo') === filter)),
    [images, summaries, filter],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep the current image in view when navigating with the keyboard.
  useEffect(() => {
    const el = scrollRef.current;
    const index = visible.findIndex((i) => i.name === currentName);
    if (!el || index < 0) return;
    const top = index * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
  }, [currentName, visible]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(visible.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  const done = counts.done + counts.skipped;

  return (
    <aside className="panel image-list">
      <div className="panel-head">
        <div className="progress-label">
          <strong>{done}</strong> of {images.length} finished
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={images.length} aria-valuenow={done}>
          <div className="progress-done" style={{ width: `${(counts.done / images.length) * 100}%` }} />
          <div className="progress-skipped" style={{ width: `${(counts.skipped / images.length) * 100}%` }} />
          <div className="progress-started" style={{ width: `${(counts['in-progress'] / images.length) * 100}%` }} />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Show images">
          <option value="all">All images ({images.length})</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]} ({counts[s]})
            </option>
          ))}
        </select>
      </div>
      <div ref={scrollRef} className="image-scroll" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div style={{ height: visible.length * ROW_HEIGHT, position: 'relative' }}>
          {visible.slice(first, last).map((image, i) => {
            const summary = summaries[image.name];
            const status = summary?.status ?? 'todo';
            return (
              <button
                key={image.name}
                className={`image-row${image.name === currentName ? ' current' : ''}`}
                style={{ top: (first + i) * ROW_HEIGHT, height: ROW_HEIGHT }}
                onClick={() => goTo(image.name)}
                title={`${image.name} · ${STATUS_LABEL[status]}`}
              >
                <span className={`status-dot ${status}`} aria-label={STATUS_LABEL[status]} />
                <span className="image-name">{image.name}</span>
                {summary && summary.annotations > 0 && <span className="count">{summary.annotations}</span>}
              </button>
            );
          })}
        </div>
        {visible.length === 0 && <p className="muted small pad">No images with this status.</p>}
      </div>
    </aside>
  );
}
