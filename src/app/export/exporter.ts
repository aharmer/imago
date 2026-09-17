import type { FolderStore, ImageEntry } from '../project/folder';
import type { ClassDef, ImageDoc, ProjectFile } from '../project/types';
import { cocoJson, csvRows, dataYaml, exportable, isValidation, readme, vocXml, yoloLabel, type Format } from './formats';

export type Include = 'annotated' | 'done';

export interface ExportOptions {
  format: Format;
  /** Copy the image files into the export, so the dataset is self-contained. */
  includeImages: boolean;
  /** Percentage of images held back for validation (0 = no split). */
  valPercent: number;
  include: Include;
}

export interface ExportPlan {
  docs: ImageDoc[];
  classes: ClassDef[];
  classIndex: Map<string, number>;
  annotations: number;
  unlabelled: number;
  /** Images left out: skipped, or (for 'done') not finished. */
  excluded: number;
}

export interface ExportSummary {
  images: number;
  annotations: number;
  filesWritten: number;
  /** Images whose EXIF says they should be rotated; their labels may not line up in other tools. */
  rotated: string[];
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

/** Read the EXIF orientation of a JPEG without decoding it. 1 means "no rotation". */
async function jpegOrientation(file: File) {
  if (!/\.jpe?g$/i.test(file.name)) return 1;
  try {
    const view = new DataView(await file.slice(0, 131072).arrayBuffer());
    if (view.byteLength < 8 || view.getUint16(0) !== 0xffd8) return 1;
    let offset = 2;
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00) return 1;
      const size = view.getUint16(offset + 2);
      if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) {
        const tiff = offset + 10;
        const little = view.getUint16(tiff) === 0x4949;
        const ifd = tiff + view.getUint32(tiff + 4, little);
        const entries = view.getUint16(ifd, little);
        for (let i = 0; i < entries; i++) {
          const entry = ifd + 2 + i * 12;
          if (entry + 12 > view.byteLength) break;
          if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
        }
        return 1;
      }
      offset += 2 + size;
    }
  } catch {
    // A truncated or unusual header is not worth failing an export over.
  }
  return 1;
}

/** Work out what would be exported, reading the annotation files from disk. */
export async function planExport(folder: FolderStore, project: ProjectFile, images: ImageEntry[], options: ExportOptions): Promise<ExportPlan> {
  const classes = project.classes;
  const classIndex = new Map(classes.map((c, i) => [c.id, i]));
  const docs: ImageDoc[] = [];
  let annotations = 0;
  let unlabelled = 0;
  let excluded = 0;

  for (const image of images) {
    const summary = project.images[image.name];
    const status = summary?.status ?? 'todo';
    const wanted = options.include === 'done' ? status === 'done' : status !== 'skipped' && (summary?.annotations ?? 0) > 0;
    if (!wanted) {
      excluded++;
      continue;
    }
    const doc = await folder.readImageDoc(image.name);
    if (!doc) continue;
    docs.push(doc);
    annotations += exportable(doc, classIndex).length;
    unlabelled += doc.annotations.length - exportable(doc, classIndex).length;
  }
  return { docs, classes, classIndex, annotations, unlabelled, excluded };
}

async function writeText(dir: FileSystemDirectoryHandle, name: string, text: string) {
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await writable.write(text);
  await writable.close();
}

async function copyFile(dir: FileSystemDirectoryHandle, file: File) {
  const writable = await (await dir.getFileHandle(file.name, { create: true })).createWritable();
  await writable.write(file);
  await writable.close();
}

const subdir = (parent: FileSystemDirectoryHandle, ...names: string[]) =>
  names.reduce(async (dir, name) => (await dir).getDirectoryHandle(name, { create: true }), Promise.resolve(parent));

/** Write the dataset into `target`. Calls `onProgress` after each image. */
export async function runExport(
  target: FileSystemDirectoryHandle,
  folder: FolderStore,
  images: ImageEntry[],
  plan: ExportPlan,
  options: ExportOptions,
  onProgress: (done: number, total: number) => void,
): Promise<ExportSummary> {
  const { docs, classes, classIndex } = plan;
  const handles = new Map(images.map((i) => [i.name, i.handle]));
  const rotated: string[] = [];
  let filesWritten = 0;
  const splits = new Map(docs.map((doc) => [doc.image.name, isValidation(doc.image.name, options.valPercent) ? 'val' : 'train'] as const));
  // A small dataset can end up with nothing in validation even at 20%; don't point data.yaml at an empty folder.
  const hasVal = [...splits.values()].includes('val');

  const copyImage = async (doc: ImageDoc, ...path: string[]) => {
    const handle = handles.get(doc.image.name);
    if (!handle) return;
    const file = await handle.getFile();
    if ((await jpegOrientation(file)) !== 1) rotated.push(doc.image.name);
    if (!options.includeImages) return;
    await copyFile(await subdir(target, ...path), file);
    filesWritten++;
  };

  if (options.format.startsWith('yolo')) {
    for (const [i, doc] of docs.entries()) {
      const split = splits.get(doc.image.name)!;
      await writeText(await subdir(target, 'labels', split), `${baseName(doc.image.name)}.txt`, yoloLabel(doc, classIndex, options.format));
      filesWritten++;
      await copyImage(doc, 'images', split);
      onProgress(i + 1, docs.length);
    }
    await writeText(target, 'data.yaml', dataYaml(classes, hasVal));
    filesWritten++;
  } else if (options.format === 'coco') {
    for (const [i, doc] of docs.entries()) {
      await copyImage(doc, 'images', splits.get(doc.image.name)!);
      onProgress(i + 1, docs.length);
    }
    if (hasVal) {
      for (const split of ['train', 'val'] as const) {
        const subset = docs.filter((d) => splits.get(d.image.name) === split);
        await writeText(target, `annotations_${split}.json`, cocoJson({ docs: subset, classes, classIndex }));
        filesWritten++;
      }
    } else {
      await writeText(target, 'annotations.json', cocoJson({ docs, classes, classIndex }));
      filesWritten++;
    }
  } else if (options.format === 'voc') {
    for (const [i, doc] of docs.entries()) {
      await writeText(await subdir(target, 'Annotations'), `${baseName(doc.image.name)}.xml`, vocXml(doc, classes, classIndex, folder.name));
      filesWritten++;
      await copyImage(doc, 'JPEGImages');
      onProgress(i + 1, docs.length);
    }
    const sets = await subdir(target, 'ImageSets', 'Main');
    for (const split of ['train', 'val'] as const) {
      const names = docs.filter((d) => splits.get(d.image.name) === split).map((d) => baseName(d.image.name));
      if (split === 'val' && !hasVal) continue;
      await writeText(sets, `${split}.txt`, names.join('\n') + '\n');
      filesWritten++;
    }
  } else {
    for (const [i, doc] of docs.entries()) {
      await copyImage(doc, 'images');
      onProgress(i + 1, docs.length);
    }
    await writeText(target, 'annotations.csv', csvRows(docs, classes, classIndex, hasVal ? splits : undefined));
    filesWritten++;
  }

  await writeText(target, 'README.txt', readme(options.format, options.includeImages));
  filesWritten++;
  return { images: docs.length, annotations: plan.annotations, filesWritten, rotated };
}
