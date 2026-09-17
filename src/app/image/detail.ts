import type { Region } from '../segment/protocol';

/** Images bigger than this are not decoded for detail crops; the memory spike isn't worth it. */
export const MAX_DETAIL_PIXELS = 150_000_000;

interface Pending {
  resolve: (tile: ImageBitmap) => void;
  reject: (error: Error) => void;
}

/** Cuts full-resolution pieces out of the original image files, in a worker. */
class Detailer {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  crop(name: string, blob: Blob, region: Region, maxSize: number, allowUpscale: boolean) {
    this.worker ??= new Worker(new URL('./detailWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<{ id: number; tile?: ImageBitmap; error?: string }>) => {
      const waiting = this.pending.get(event.data.id);
      if (!waiting) return;
      this.pending.delete(event.data.id);
      if (event.data.tile) waiting.resolve(event.data.tile);
      else waiting.reject(new Error(event.data.error ?? 'Could not read that part of the image'));
    };
    const id = this.nextId++;
    const promise = new Promise<ImageBitmap>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.worker.postMessage({ id, name, blob, region, maxSize, allowUpscale });
    return promise;
  }
}

export const detailer = new Detailer();
