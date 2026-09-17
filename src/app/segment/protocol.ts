export type Device = 'webgpu' | 'wasm';

/** A rectangle in original image pixels. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PromptPoint {
  x: number;
  y: number;
  /** true = part of the object, false = not part of it. */
  positive: boolean;
}

export type ToSegmentWorker =
  | { type: 'init'; id: number; preferGpu: boolean }
  /** Encode a (downscaled) picture of `region`; later prompts on `key` reuse the result. */
  | { type: 'encode'; id: number; key: string; bitmap: ImageBitmap; region: Region }
  | { type: 'segment'; id: number; key: string; points: PromptPoint[]; box: Region | null };

export type SegmentResult = {
  /** Closed ring in original image pixels, or null when the model found nothing. */
  polygon: Array<[number, number]> | null;
  score: number;
};

export type FromSegmentWorker =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; id: number; device: Device }
  | { type: 'encoded'; id: number }
  | { type: 'segmented'; id: number; result: SegmentResult }
  | { type: 'error'; id: number; message: string; notEncoded?: boolean };
