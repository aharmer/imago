import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isTyping } from '../keyboard';
import { useStore } from '../store';
import type { Annotation, BoxShape, ClassDef, Shape } from '../project/types';

type Point = [number, number];
interface View {
  scale: number;
  x: number;
  y: number;
}
type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Drag =
  | { kind: 'pan'; startX: number; startY: number; origin: View }
  | { kind: 'box'; start: Point; current: Point }
  | { kind: 'move'; id: string; start: Point; original: Shape; moved: boolean }
  | { kind: 'corner'; id: string; corner: Corner; original: BoxShape }
  | { kind: 'vertex'; id: string; index: number; original: Point[] };

const UNLABELLED = '#9ca3af';
const MIN_BOX_SCREEN_PX = 4;
const CLOSE_POLYGON_SCREEN_PX = 10;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round = (v: number) => Math.round(v * 100) / 100;

function normalizeBox(a: Point, b: Point): BoxShape {
  return {
    type: 'box',
    x: round(Math.min(a[0], b[0])),
    y: round(Math.min(a[1], b[1])),
    width: round(Math.abs(a[0] - b[0])),
    height: round(Math.abs(a[1] - b[1])),
  };
}

function translate(shape: Shape, dx: number, dy: number, w: number, h: number): Shape {
  if (shape.type === 'box') {
    return { ...shape, x: round(clamp(shape.x + dx, 0, w - shape.width)), y: round(clamp(shape.y + dy, 0, h - shape.height)) };
  }
  const xs = shape.points.map((p) => p[0]);
  const ys = shape.points.map((p) => p[1]);
  const cdx = clamp(dx, -Math.min(...xs), w - Math.max(...xs));
  const cdy = clamp(dy, -Math.min(...ys), h - Math.max(...ys));
  return { ...shape, points: shape.points.map(([x, y]) => [round(x + cdx), round(y + cdy)]) };
}

export function Viewer() {
  const image = useStore((s) => s.image);
  const doc = useStore((s) => s.doc);
  const imageError = useStore((s) => s.imageError);
  const tool = useStore((s) => s.tool);
  const selectedId = useStore((s) => s.selectedId);
  const classes = useStore((s) => s.project.classes);
  const activeClassId = useStore((s) => s.activeClassId);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<Point[]>([]);
  const [hover, setHover] = useState<Point | null>(null);
  const spaceHeld = useRef(false);

  const updateDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  /** True until the user zooms or pans, so window resizes keep the image fitted. */
  const fitted = useRef(true);
  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el || !image || el.clientWidth === 0) return;
    const { clientWidth: cw, clientHeight: ch } = el;
    const scale = Math.min(cw / image.width, ch / image.height) * 0.96;
    fitted.current = true;
    setView({ scale, x: (cw - image.width * scale) / 2, y: (ch - image.height * scale) / 2 });
  }, [image]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (fitted.current) fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  // Draw the bitmap and fit it to the viewport whenever the image changes.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    canvas.width = image.bitmap.width;
    canvas.height = image.bitmap.height;
    canvas.getContext('2d')!.drawImage(image.bitmap, 0, 0);
    fit();
    setDraft([]);
    updateDrag(null);
  }, [image, fit]);

  // Leaving the polygon tool abandons an unfinished polygon.
  useEffect(() => {
    if (tool !== 'polygon') setDraft([]);
  }, [tool]);

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return [(clientX - rect.left - v.x) / v.scale, (clientY - rect.top - v.y) / v.scale];
  }, []);

  const clampToImage = (p: Point): Point => (image ? [clamp(p[0], 0, image.width), clamp(p[1], 0, image.height)] : p);

  // Wheel zoom around the cursor. Needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      fitted.current = false;
      const rect = el.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      setView((v) => {
        const scale = clamp(v.scale * Math.exp(-event.deltaY * 0.0015), 0.01, 40);
        const k = scale / v.scale;
        return { scale, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const finishPolygon = useCallback(() => {
    // A double-click to finish also adds two clicks' worth of points at the same spot; drop them.
    const minGap = 2 / viewRef.current.scale;
    const points = draft.filter((p, i) => i === 0 || Math.hypot(p[0] - draft[i - 1][0], p[1] - draft[i - 1][1]) > minGap);
    if (points.length >= 3) useStore.getState().addAnnotation({ type: 'polygon', points: points.map(([x, y]) => [round(x), round(y)]) });
    setDraft([]);
  }, [draft]);

  // Keys that belong to the viewer. Registered in the capture phase so they win over global shortcuts.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event)) return;
      if (event.code === 'Space') {
        spaceHeld.current = true;
        event.preventDefault();
        return;
      }
      if (event.key === 'f' || event.key === 'F') {
        fit();
        return;
      }
      if (draft.length === 0) return;
      if (event.key === 'Enter') finishPolygon();
      else if (event.key === 'Escape') setDraft([]);
      else if (event.key === 'Backspace') setDraft((d) => d.slice(0, -1));
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') spaceHeld.current = false;
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [draft, finishPolygon, fit]);

  const store = useStore.getState;

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!image) return;
    const panRequested = event.button === 1 || (event.button === 0 && spaceHeld.current);
    if (panRequested || (event.button === 0 && tool === 'select')) {
      if (!panRequested) store().select(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      updateDrag({ kind: 'pan', startX: event.clientX, startY: event.clientY, origin: viewRef.current });
      return;
    }
    if (event.button !== 0) return;
    const p = clampToImage(toWorld(event.clientX, event.clientY));
    if (tool === 'box') {
      event.currentTarget.setPointerCapture(event.pointerId);
      updateDrag({ kind: 'box', start: p, current: p });
    } else if (tool === 'polygon') {
      const first = draft[0];
      const closeEnough = first && Math.hypot(first[0] - p[0], first[1] - p[1]) * viewRef.current.scale < CLOSE_POLYGON_SCREEN_PX;
      if (draft.length >= 3 && closeEnough) finishPolygon();
      else setDraft((d) => [...d, p]);
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!image) return;
    const d = dragRef.current;
    const p = toWorld(event.clientX, event.clientY);
    if (tool === 'polygon') setHover(clampToImage(p));
    if (!d) return;
    if (d.kind === 'pan') {
      fitted.current = false;
      setView({ ...d.origin, x: d.origin.x + event.clientX - d.startX, y: d.origin.y + event.clientY - d.startY });
    } else if (d.kind === 'box') {
      updateDrag({ ...d, current: clampToImage(p) });
    } else if (d.kind === 'move') {
      if (!d.moved) store().beginEdit();
      store().updateShape(d.id, translate(d.original, p[0] - d.start[0], p[1] - d.start[1], image.width, image.height), { record: false });
      if (!d.moved) updateDrag({ ...d, moved: true });
    } else if (d.kind === 'corner') {
      const { x, y, width, height } = d.original;
      const fixed: Point = [d.corner.includes('w') ? x + width : x, d.corner.includes('n') ? y + height : y];
      store().updateShape(d.id, normalizeBox(fixed, clampToImage(p)), { record: false });
    } else if (d.kind === 'vertex') {
      const points = d.original.map((pt, i) => (i === d.index ? clampToImage(p).map(round) as Point : pt));
      store().updateShape(d.id, { type: 'polygon', points }, { record: false });
    }
  }

  function onPointerUp() {
    const d = dragRef.current;
    if (d?.kind === 'box') {
      const box = normalizeBox(d.start, d.current);
      const minSize = MIN_BOX_SCREEN_PX / viewRef.current.scale;
      if (box.width >= minSize && box.height >= minSize) store().addAnnotation(box);
    }
    updateDrag(null);
  }

  function startShapeDrag(event: React.PointerEvent, annotation: Annotation) {
    if (tool !== 'select' || event.button !== 0 || spaceHeld.current) return;
    event.stopPropagation();
    containerRef.current!.setPointerCapture(event.pointerId);
    store().select(annotation.id);
    updateDrag({ kind: 'move', id: annotation.id, start: toWorld(event.clientX, event.clientY), original: annotation.shape, moved: false });
  }

  function startCornerDrag(event: React.PointerEvent, annotation: Annotation, corner: Corner) {
    if (annotation.shape.type !== 'box' || event.button !== 0) return;
    event.stopPropagation();
    containerRef.current!.setPointerCapture(event.pointerId);
    store().beginEdit();
    updateDrag({ kind: 'corner', id: annotation.id, corner, original: annotation.shape });
  }

  function startVertexDrag(event: React.PointerEvent, annotation: Annotation, index: number) {
    if (annotation.shape.type !== 'polygon' || event.button !== 0) return;
    event.stopPropagation();
    if (event.altKey) {
      // Alt-click removes a vertex, keeping at least a triangle.
      if (annotation.shape.points.length > 3) {
        store().updateShape(annotation.id, { type: 'polygon', points: annotation.shape.points.filter((_, i) => i !== index) });
      }
      return;
    }
    containerRef.current!.setPointerCapture(event.pointerId);
    store().beginEdit();
    updateDrag({ kind: 'vertex', id: annotation.id, index, original: annotation.shape.points });
  }

  if (imageError) return <div className="viewer empty">Couldn't open this image: {imageError}</div>;

  const classById = new Map<string, ClassDef>(classes.map((c) => [c.id, c]));
  const s = view.scale;
  const handleR = 5 / s;
  const activeColor = classById.get(activeClassId ?? '')?.color ?? UNLABELLED;
  const cursor = drag?.kind === 'pan' ? 'grabbing' : tool === 'select' ? 'grab' : 'crosshair';

  return (
    <div
      ref={containerRef}
      className="viewer"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={() => tool === 'polygon' && finishPolygon()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {!image && <div className="viewer-loading">Loading image…</div>}
      {image && (
        <div className="world" style={{ width: image.width, height: image.height, transform: `matrix(${s},0,0,${s},${view.x},${view.y})` }}>
          <canvas ref={canvasRef} className="world-image" />
          <svg className="world-overlay" width={image.width} height={image.height} viewBox={`0 0 ${image.width} ${image.height}`}>
            {doc?.annotations.map((a) => {
              const cls = a.classId ? classById.get(a.classId) : undefined;
              const color = cls?.color ?? UNLABELLED;
              const selected = a.id === selectedId;
              const common = {
                className: `shape${selected ? ' selected' : ''}${cls ? '' : ' unlabelled'}`,
                stroke: color,
                fill: color,
                style: { pointerEvents: tool === 'select' ? ('all' as const) : ('none' as const) },
                onPointerDown: (e: React.PointerEvent) => startShapeDrag(e, a),
              };
              const bounds =
                a.shape.type === 'box'
                  ? a.shape
                  : { x: Math.min(...a.shape.points.map((p) => p[0])), y: Math.min(...a.shape.points.map((p) => p[1])) };
              return (
                <g key={a.id}>
                  {a.shape.type === 'box' ? (
                    <rect {...common} x={a.shape.x} y={a.shape.y} width={a.shape.width} height={a.shape.height} />
                  ) : (
                    <polygon {...common} points={a.shape.points.map((p) => p.join(',')).join(' ')} />
                  )}
                  <text className="shape-label" x={bounds.x} y={bounds.y - 4 / s} fontSize={12 / s} strokeWidth={3 / s} fill={color}>
                    {cls?.name ?? 'Unlabelled'}
                  </text>
                  {selected && tool === 'select' && a.shape.type === 'box' &&
                    (['nw', 'ne', 'sw', 'se'] as Corner[]).map((corner) => {
                      const shape = a.shape as BoxShape;
                      return (
                        <rect
                          key={corner}
                          className={`handle handle-${corner}`}
                          x={(corner.includes('w') ? shape.x : shape.x + shape.width) - handleR}
                          y={(corner.includes('n') ? shape.y : shape.y + shape.height) - handleR}
                          width={handleR * 2}
                          height={handleR * 2}
                          strokeWidth={1.5 / s}
                          onPointerDown={(e) => startCornerDrag(e, a, corner)}
                        />
                      );
                    })}
                  {selected && tool === 'select' && a.shape.type === 'polygon' &&
                    a.shape.points.map((p, i) => (
                      <circle
                        key={i}
                        className="handle vertex"
                        cx={p[0]}
                        cy={p[1]}
                        r={handleR}
                        strokeWidth={1.5 / s}
                        onPointerDown={(e) => startVertexDrag(e, a, i)}
                      />
                    ))}
                </g>
              );
            })}

            {drag?.kind === 'box' && (() => {
              const b = normalizeBox(drag.start, drag.current);
              return <rect className="shape drawing" x={b.x} y={b.y} width={b.width} height={b.height} stroke={activeColor} fill={activeColor} />;
            })()}

            {draft.length > 0 && (
              <g className="draft">
                <polyline
                  className="shape drawing"
                  points={[...draft, ...(hover ? [hover] : [])].map((p) => p.join(',')).join(' ')}
                  stroke={activeColor}
                  fill="none"
                />
                {draft.map((p, i) => (
                  <circle key={i} className={`handle vertex${i === 0 && draft.length >= 3 ? ' closable' : ''}`} cx={p[0]} cy={p[1]} r={handleR} strokeWidth={1.5 / s} />
                ))}
              </g>
            )}
          </svg>
        </div>
      )}
      {image && (
        <div className="viewer-hud">
          {Math.round(s * 100)}% · {image.width}×{image.height}
          {tool === 'polygon' && (draft.length === 0 ? ' · Click to add points' : ' · Click the first point, double-click or press Enter to finish')}
        </div>
      )}
    </div>
  );
}
