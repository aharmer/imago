import { useEffect, useRef } from 'react';
import type { MaskOverlay, Point } from './protocol';

export interface LoadedImage {
  file: File;
  width: number;
  height: number;
  /** Downscaled copy for display, at device-pixel resolution. */
  display: ImageBitmap;
  /** On-screen width in CSS pixels. */
  cssWidth: number;
}

interface Props {
  image: LoadedImage;
  overlay: MaskOverlay | null;
  points: Point[];
  onPoint: (point: Point) => void;
}

export function Preview({ image, overlay, points, onPoint }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { width: dw, height: dh } = image.display;

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, dw, dh);
    ctx.drawImage(image.display, 0, 0);
    const k = dw / image.width;
    if (overlay) {
      ctx.drawImage(overlay.bitmap, 0, 0, dw, dh);
      if (overlay.box) {
        ctx.strokeStyle = '#ffb000';
        ctx.lineWidth = Math.max(2, dw / 400);
        ctx.setLineDash([8, 5]);
        ctx.strokeRect(overlay.box.x * k, overlay.box.y * k, overlay.box.width * k, overlay.box.height * k);
        ctx.setLineDash([]);
      }
    }
    const r = Math.max(5, dw / 150);
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x * k, p.y * k, r, 0, Math.PI * 2);
      ctx.fillStyle = p.positive ? '#16a34a' : '#dc2626';
      ctx.fill();
      ctx.lineWidth = r / 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  }, [image, overlay, points, dw, dh]);

  const handle = (event: React.MouseEvent<HTMLCanvasElement>, positive: boolean) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    onPoint({
      x: ((event.clientX - rect.left) / rect.width) * image.width,
      y: ((event.clientY - rect.top) / rect.height) * image.height,
      positive: positive && !event.shiftKey && !event.altKey,
    });
  };

  return (
    <canvas
      ref={canvasRef}
      className="preview"
      width={dw}
      height={dh}
      style={{ width: image.cssWidth }}
      onClick={(e) => handle(e, true)}
      onContextMenu={(e) => handle(e, false)}
    />
  );
}
