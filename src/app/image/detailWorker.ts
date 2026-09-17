// Cuts a piece out of an image at full resolution, off the main thread.
// Used both to show sharp detail when zoomed in, and to give the segmentation model a sharper crop.
import type { Region } from '../segment/protocol';

interface Request {
  id: number;
  name: string;
  blob: Blob;
  region: Region;
  /** Longest side of the returned picture. */
  maxSize: number;
  /** Allow scaling the crop up to maxSize (the model wants a fixed size; the display doesn't). */
  allowUpscale: boolean;
}

interface WorkerScope {
  postMessage(message: { id: number; tile?: ImageBitmap; error?: string }, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<Request>) => void) | null;
}
const scope = self as unknown as WorkerScope;

/** Hold on to the decoded image between crops, but only when it's small enough to be worth the memory. */
const CACHE_PIXEL_LIMIT = 30_000_000;
let cached: { name: string; bitmap: ImageBitmap } | null = null;

let queue = Promise.resolve();
scope.onmessage = (event) => {
  const { id, name, blob, region, maxSize, allowUpscale } = event.data;
  queue = queue.then(async () => {
    try {
      let full = cached?.name === name ? cached.bitmap : null;
      if (!full) {
        full = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        cached?.bitmap.close();
        cached = full.width * full.height <= CACHE_PIXEL_LIMIT ? { name, bitmap: full } : null;
      }
      const fit = maxSize / Math.max(region.width, region.height);
      const scale = allowUpscale ? fit : Math.min(1, fit);
      const tile = await createImageBitmap(full, region.x, region.y, region.width, region.height, {
        resizeWidth: Math.max(1, Math.round(region.width * scale)),
        resizeHeight: Math.max(1, Math.round(region.height * scale)),
        resizeQuality: 'high',
      });
      if (cached?.bitmap !== full) full.close();
      scope.postMessage({ id, tile }, [tile]);
    } catch (err) {
      scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  });
};
