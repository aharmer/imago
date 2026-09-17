// imago's on-disk format. Everything lives in a hidden `.imago` folder next to the images:
//
//   .imago/project.json                 classes, per-image status index, last image
//   .imago/annotations/<image>.json     annotations for one image
//   .imago/lock.json                    who has the folder open
//
// All coordinates are in original image pixels, origin top-left.

export const SCHEMA_VERSION = 1;

export type ImageStatus = 'todo' | 'in-progress' | 'done' | 'skipped';

export interface ClassDef {
  id: string;
  name: string;
  color: string;
}

export interface BoxShape {
  type: 'box';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PolygonShape {
  type: 'polygon';
  /** Closed exterior ring; the last point connects back to the first. */
  points: Array<[number, number]>;
}

export type Shape = BoxShape | PolygonShape;

export interface Annotation {
  id: string;
  /** null until a class is assigned. */
  classId: string | null;
  shape: Shape;
  /** How the shape was made: drawn by hand, or segmented by a model. */
  source: 'manual' | 'sam';
  score?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImageDoc {
  app: 'imago';
  schema: number;
  image: { name: string; width: number; height: number };
  status: ImageStatus;
  annotations: Annotation[];
  updatedAt: string;
}

export interface ImageSummary {
  status: ImageStatus;
  annotations: number;
  updatedAt: string;
}

export interface ProjectFile {
  app: 'imago';
  schema: number;
  classes: ClassDef[];
  /** Status of every image that has been touched; untouched images are 'todo'. */
  images: Record<string, ImageSummary>;
  lastImage: string | null;
  createdAt: string;
  updatedAt: string;
}

export const STATUS_LABEL: Record<ImageStatus, string> = {
  todo: 'To do',
  'in-progress': 'In progress',
  done: 'Done',
  skipped: 'Skipped',
};

export function newProject(): ProjectFile {
  const now = new Date().toISOString();
  return { app: 'imago', schema: SCHEMA_VERSION, classes: [], images: {}, lastImage: null, createdAt: now, updatedAt: now };
}

export function newImageDoc(name: string, width: number, height: number): ImageDoc {
  return {
    app: 'imago',
    schema: SCHEMA_VERSION,
    image: { name, width, height },
    status: 'todo',
    annotations: [],
    updatedAt: new Date().toISOString(),
  };
}

export const newId = () => crypto.randomUUID();

export function shapeBounds(shape: Shape): BoxShape {
  if (shape.type === 'box') return shape;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of shape.points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { type: 'box', x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Well-separated colours for new classes; cycles after the list runs out. */
const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#469990', '#dcbeff', '#9a6324', '#800000', '#aaffc3', '#808000', '#000075'];
export const nextClassColor = (existing: ClassDef[]) => PALETTE[existing.length % PALETTE.length];
