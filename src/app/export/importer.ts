// Reading annotations produced elsewhere (COCO JSON, or YOLO label files) back into imagoLabel.
import type { FolderStore, ImageEntry } from '../project/folder';
import { newId, newImageDoc, nextClassColor, type Annotation, type ClassDef, type ImageDoc, type Shape } from '../project/types';

export type ImportFormat = 'coco' | 'yolo';

export interface ImportPreview {
  format: ImportFormat;
  source: string;
  /** Class names found in the imported data, in the order they define class indices. */
  classNames: string[];
  docs: ImageDoc[];
  newClasses: ClassDef[];
  annotations: number;
  /** Images named in the imported data that aren't in this folder. */
  unmatched: string[];
  /** Images that already had annotations in imagoLabel. */
  overwriting: string[];
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

async function imageSize(entry: ImageEntry) {
  const bitmap = await createImageBitmap(await entry.handle.getFile(), { imageOrientation: 'from-image' });
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

function makeAnnotation(shape: Shape, classId: string | null): Annotation {
  const time = new Date().toISOString();
  return { id: newId(), classId, shape, source: 'manual', createdAt: time, updatedAt: time };
}

/** Match class names to existing classes (ignoring case); anything new gets a colour and is added. */
function resolveClasses(names: string[], existing: ClassDef[]) {
  const byName = new Map(existing.map((c) => [c.name.toLowerCase(), c]));
  const newClasses: ClassDef[] = [];
  const ids = names.map((name) => {
    const match = byName.get(name.toLowerCase());
    if (match) return match.id;
    const created: ClassDef = { id: newId(), name, color: nextClassColor([...existing, ...newClasses]) };
    newClasses.push(created);
    byName.set(name.toLowerCase(), created);
    return created.id;
  });
  return { ids, newClasses };
}

interface Building {
  entry: ImageEntry;
  annotations: Annotation[];
}

async function buildDocs(building: Map<string, Building>, folder: FolderStore, onProgress: (done: number, total: number) => void) {
  const docs: ImageDoc[] = [];
  const overwriting: string[] = [];
  let done = 0;
  for (const [name, { entry, annotations }] of building) {
    const existing = await folder.readImageDoc(name);
    if (existing && existing.annotations.length > 0) overwriting.push(name);
    const size = existing ? existing.image : await imageSize(entry);
    const doc: ImageDoc = existing
      ? { ...existing, annotations, updatedAt: new Date().toISOString() }
      : { ...newImageDoc(name, size.width, size.height), annotations };
    docs.push({ ...doc, status: doc.status === 'todo' && annotations.length > 0 ? 'in-progress' : doc.status });
    onProgress(++done, building.size);
  }
  return { docs, overwriting };
}

/** Scale annotations when the file says the image is a different size from the actual image. */
const scaleShape = (shape: Shape, kx: number, ky: number): Shape =>
  shape.type === 'box'
    ? { ...shape, x: shape.x * kx, y: shape.y * ky, width: shape.width * kx, height: shape.height * ky }
    : { ...shape, points: shape.points.map(([x, y]): [number, number] => [x * kx, y * ky]) };

export async function previewCoco(
  file: File,
  folder: FolderStore,
  images: ImageEntry[],
  existingClasses: ClassDef[],
  onProgress: (done: number, total: number) => void,
): Promise<ImportPreview> {
  const data = JSON.parse(await file.text()) as {
    images?: Array<{ id: number; file_name: string; width?: number; height?: number }>;
    annotations?: Array<{ image_id: number; category_id: number; bbox?: number[]; segmentation?: number[][] | unknown }>;
    categories?: Array<{ id: number; name: string }>;
  };
  if (!Array.isArray(data.images) || !Array.isArray(data.annotations)) throw new Error('This file is not COCO JSON: it has no "images" and "annotations" lists.');

  const categories = data.categories ?? [];
  const { ids, newClasses } = resolveClasses(
    categories.map((c) => c.name),
    existingClasses,
  );
  const classIdByCategory = new Map(categories.map((c, i) => [c.id, ids[i]]));
  const byName = new Map(images.map((i) => [i.name, i]));
  const cocoImages = new Map(data.images.map((i) => [i.id, i]));
  const building = new Map<string, Building>();
  const unmatched = new Set<string>();

  for (const annotation of data.annotations) {
    const image = cocoImages.get(annotation.image_id);
    if (!image) continue;
    const name = fileName(image.file_name);
    const entry = byName.get(name);
    if (!entry) {
      unmatched.add(name);
      continue;
    }
    const polygon = Array.isArray(annotation.segmentation) && Array.isArray(annotation.segmentation[0]) ? (annotation.segmentation[0] as number[]) : null;
    let shape: Shape | null = null;
    if (polygon && polygon.length >= 6) {
      const points: Array<[number, number]> = [];
      for (let i = 0; i + 1 < polygon.length; i += 2) points.push([polygon[i], polygon[i + 1]]);
      shape = { type: 'polygon', points };
    } else if (annotation.bbox?.length === 4) {
      const [x, y, width, height] = annotation.bbox;
      shape = { type: 'box', x, y, width, height };
    }
    if (!shape) continue;
    const group = building.get(name) ?? { entry, annotations: [] };
    group.annotations.push(makeAnnotation(shape, classIdByCategory.get(annotation.category_id) ?? null));
    building.set(name, group);
  }

  const { docs, overwriting } = await buildDocs(building, folder, onProgress);
  // COCO records the size it was annotated at; rescale if the image on disk differs.
  for (const doc of docs) {
    const recorded = data.images.find((i) => fileName(i.file_name) === doc.image.name);
    if (!recorded?.width || !recorded.height) continue;
    if (recorded.width === doc.image.width && recorded.height === doc.image.height) continue;
    const kx = doc.image.width / recorded.width;
    const ky = doc.image.height / recorded.height;
    doc.annotations = doc.annotations.map((a) => ({ ...a, shape: scaleShape(a.shape, kx, ky) }));
  }

  return {
    format: 'coco',
    source: file.name,
    classNames: categories.map((c) => c.name),
    docs,
    newClasses,
    annotations: docs.reduce((sum, d) => sum + d.annotations.length, 0),
    unmatched: [...unmatched],
    overwriting,
  };
}

/** Class names from a YOLO data.yaml (list or index map) or a classes.txt. */
export function parseClassNames(text: string, fromYaml: boolean): string[] {
  if (!fromYaml) return text.split('\n').map((l) => l.trim()).filter(Boolean);
  const inline = text.match(/^names:\s*\[(.*)\]/m);
  if (inline) return inline[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^names:\s*$/.test(l.trim()));
  if (start < 0) return [];
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const item = line.match(/^\s+-\s*(.+?)\s*$/);
    const indexed = line.match(/^\s+(\d+)\s*:\s*(.+?)\s*$/);
    if (indexed) names[Number(indexed[1])] = indexed[2].replace(/^['"]|['"]$/g, '');
    else if (item) names.push(item[1].replace(/^['"]|['"]$/g, ''));
    else if (line.trim() && !line.startsWith(' ')) break;
  }
  return [...names].map((name) => name ?? '');
}

async function collectFiles(dir: FileSystemDirectoryHandle, match: RegExp, out: Map<string, FileSystemFileHandle>, depth = 0) {
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory' && depth < 3) await collectFiles(entry, match, out, depth + 1);
    else if (entry.kind === 'file' && match.test(entry.name) && !out.has(entry.name)) out.set(entry.name, entry);
  }
}

export async function previewYolo(
  source: FileSystemDirectoryHandle,
  folder: FolderStore,
  images: ImageEntry[],
  existingClasses: ClassDef[],
  onProgress: (done: number, total: number) => void,
): Promise<ImportPreview> {
  const labels = new Map<string, FileSystemFileHandle>();
  await collectFiles(source, /\.txt$/i, labels);
  labels.delete('classes.txt');
  if (labels.size === 0) throw new Error('No .txt label files found in that folder.');

  const meta = new Map<string, FileSystemFileHandle>();
  await collectFiles(source, /^(data\.yaml|data\.yml|classes\.txt)$/i, meta);
  let classNames: string[] = [];
  for (const [name, handle] of meta) {
    const text = await (await handle.getFile()).text();
    const parsed = parseClassNames(text, /\.ya?ml$/i.test(name));
    if (parsed.length) {
      classNames = parsed;
      break;
    }
  }

  const byBase = new Map(images.map((i) => [baseName(i.name), i]));
  const parsed = new Map<string, { entry: ImageEntry; items: Array<{ shape: Shape; index: number }> }>();
  const unmatched = new Set<string>();
  const usedIndexes = new Set<number>();
  let read = 0;

  for (const [labelName, handle] of labels) {
    onProgress(++read, labels.size);
    // Read the numbers first: a .txt with no label lines (a README, say) isn't a missing image.
    const rows: number[][] = [];
    for (const line of (await (await handle.getFile()).text()).split('\n')) {
      const parts = line.trim().split(/\s+/).filter(Boolean).map(Number);
      if (parts.length >= 5 && !parts.some(Number.isNaN)) rows.push(parts);
    }
    if (rows.length === 0) continue;
    const entry = byBase.get(baseName(labelName));
    if (!entry) {
      unmatched.add(labelName);
      continue;
    }
    // YOLO coordinates are fractions of the image, so the image itself gives the pixel size.
    const size = await imageSize(entry);
    const items: Array<{ shape: Shape; index: number }> = [];
    for (const parts of rows) {
      const [index, ...rest] = parts;
      if (rest.length === 4) {
        const [cx, cy, w, h] = rest;
        items.push({ index, shape: { type: 'box', x: (cx - w / 2) * size.width, y: (cy - h / 2) * size.height, width: w * size.width, height: h * size.height } });
      } else if (rest.length >= 6 && rest.length % 2 === 0) {
        const points: Array<[number, number]> = [];
        for (let i = 0; i + 1 < rest.length; i += 2) points.push([rest[i] * size.width, rest[i + 1] * size.height]);
        items.push({ index, shape: { type: 'polygon', points } });
      } else {
        continue;
      }
      usedIndexes.add(index);
    }
    if (items.length) parsed.set(entry.name, { entry, items });
  }

  // Fill in names for any class index the labels use but the names file doesn't cover.
  const highest = Math.max(-1, ...usedIndexes);
  for (let i = 0; i <= highest; i++) if (!classNames[i]) classNames[i] = `class_${i}`;
  const { ids, newClasses } = resolveClasses(classNames, existingClasses);

  const building = new Map<string, Building>();
  for (const [name, { entry, items }] of parsed) {
    building.set(name, { entry, annotations: items.map(({ shape, index }) => makeAnnotation(shape, ids[index] ?? null)) });
  }

  const { docs, overwriting } = await buildDocs(building, folder, () => undefined);
  return {
    format: 'yolo',
    source: source.name,
    classNames,
    docs,
    newClasses,
    annotations: docs.reduce((sum, d) => sum + d.annotations.length, 0),
    unmatched: [...unmatched],
    overwriting,
  };
}
