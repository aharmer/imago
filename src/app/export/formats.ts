// Turning imagoLabel's annotations into the file formats training pipelines expect.
// Every format takes coordinates in original image pixels and writes whatever units it needs.
import { shapeBounds, type Annotation, type ClassDef, type ImageDoc } from '../project/types';

export type Format = 'yolo-detect' | 'yolo-segment' | 'coco' | 'voc' | 'csv';

export const FORMAT_LABEL: Record<Format, string> = {
  'yolo-detect': 'YOLO — boxes (Ultralytics detect)',
  'yolo-segment': 'YOLO — polygons (Ultralytics segment)',
  coco: 'COCO JSON',
  voc: 'Pascal VOC XML',
  csv: 'CSV',
};

export const FORMAT_NOTE: Record<Format, string> = {
  'yolo-detect': 'One .txt per image with a box per line, plus data.yaml. Polygons are converted to their bounding box.',
  'yolo-segment': 'One .txt per image with a polygon per line, plus data.yaml. Boxes are written as four-corner polygons.',
  coco: 'A single annotations.json holding boxes and polygons.',
  voc: 'One .xml per image, boxes only. Polygons are converted to their bounding box.',
  csv: 'One row per annotation: class, box, and the polygon when there is one.',
};

/** Formats that describe a polygon; the others get bounding boxes. */
export const keepsPolygons = (format: Format) => format === 'yolo-segment' || format === 'coco' || format === 'csv';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const n = (v: number, decimals = 6) => Number(v.toFixed(decimals)).toString();

/** Annotations that can be exported: those with a class. */
export const exportable = (doc: ImageDoc, classIndex: Map<string, number>) =>
  doc.annotations.filter((a) => a.classId !== null && classIndex.has(a.classId));

function polygonPoints(annotation: Annotation): Array<[number, number]> {
  if (annotation.shape.type === 'polygon') return annotation.shape.points;
  const { x, y, width, height } = annotation.shape;
  return [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ];
}

export function yoloLabel(doc: ImageDoc, classIndex: Map<string, number>, format: Format) {
  const { width, height } = doc.image;
  const lines = exportable(doc, classIndex).map((a) => {
    const index = classIndex.get(a.classId!)!;
    if (format === 'yolo-segment') {
      const coords = polygonPoints(a).flatMap(([x, y]) => [n(clamp01(x / width)), n(clamp01(y / height))]);
      return `${index} ${coords.join(' ')}`;
    }
    const box = shapeBounds(a.shape);
    return `${index} ${n(clamp01((box.x + box.width / 2) / width))} ${n(clamp01((box.y + box.height / 2) / height))} ${n(clamp01(box.width / width))} ${n(clamp01(box.height / height))}`;
  });
  return lines.join('\n') + (lines.length ? '\n' : '');
}

/** Ultralytics resolves relative train/val paths against the folder holding data.yaml when `path` is omitted. */
export function dataYaml(classes: ClassDef[], hasVal: boolean) {
  const names = classes.map((c, i) => `  ${i}: ${JSON.stringify(c.name)}`).join('\n');
  return [
    '# Dataset exported by imagoLabel (https://imago-label.vercel.app)',
    `# Created ${new Date().toISOString()}`,
    '',
    'train: images/train',
    `val: images/${hasVal ? 'val' : 'train'}`,
    '',
    'names:',
    names,
    '',
  ].join('\n');
}

export function readme(format: Format, hasImages: boolean) {
  const lines = [
    'Dataset exported by imagoLabel',
    '==============================',
    '',
    `Format: ${FORMAT_LABEL[format]}`,
    `Created: ${new Date().toISOString()}`,
    '',
  ];
  if (format.startsWith('yolo')) {
    lines.push(
      'Train with Ultralytics:',
      '',
      `  yolo ${format === 'yolo-segment' ? 'segment' : 'detect'} train data=data.yaml model=${format === 'yolo-segment' ? 'yolo11n-seg.pt' : 'yolo11n.pt'} epochs=100 imgsz=640`,
      '',
      'Label files use normalised coordinates (0-1) and class indices matching the order in data.yaml.',
    );
    if (!hasImages) {
      lines.push(
        '',
        'This export contains labels only. Copy your images into images/train and images/val',
        'so each image sits beside the label file of the same name.',
      );
    }
  } else if (format === 'coco') {
    lines.push('annotations.json follows the COCO instance format: bbox is [x, y, width, height] in pixels,', 'and segmentation holds polygons as [x1, y1, x2, y2, ...].');
  } else if (format === 'voc') {
    lines.push('One XML file per image in Annotations/, in the Pascal VOC layout.');
  } else {
    lines.push('annotations.csv has one row per annotation. Boxes are in pixels (xmin, ymin, xmax, ymax).');
  }
  return lines.join('\n') + '\n';
}

export interface CocoOptions {
  docs: ImageDoc[];
  classes: ClassDef[];
  classIndex: Map<string, number>;
}

export function cocoJson({ docs, classes, classIndex }: CocoOptions) {
  const images = docs.map((doc, i) => ({ id: i + 1, file_name: doc.image.name, width: doc.image.width, height: doc.image.height }));
  const annotations: unknown[] = [];
  docs.forEach((doc, i) => {
    for (const a of exportable(doc, classIndex)) {
      const box = shapeBounds(a.shape);
      annotations.push({
        id: annotations.length + 1,
        image_id: i + 1,
        category_id: classIndex.get(a.classId!)! + 1,
        bbox: [box.x, box.y, box.width, box.height].map((v) => Number(v.toFixed(2))),
        area: Number((box.width * box.height).toFixed(2)),
        iscrowd: 0,
        segmentation: a.shape.type === 'polygon' ? [a.shape.points.flat().map((v) => Number(v.toFixed(2)))] : [],
      });
    }
  });
  return JSON.stringify(
    {
      info: { description: 'Exported by imagoLabel', date_created: new Date().toISOString() },
      images,
      annotations,
      categories: classes.map((c, i) => ({ id: i + 1, name: c.name, supercategory: 'none' })),
    },
    null,
    1,
  );
}

const xmlEscape = (value: string) => value.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

export function vocXml(doc: ImageDoc, classes: ClassDef[], classIndex: Map<string, number>, folderName: string) {
  const objects = exportable(doc, classIndex).map((a) => {
    const box = shapeBounds(a.shape);
    return [
      '  <object>',
      `    <name>${xmlEscape(classes[classIndex.get(a.classId!)!].name)}</name>`,
      '    <pose>Unspecified</pose>',
      '    <truncated>0</truncated>',
      '    <difficult>0</difficult>',
      '    <bndbox>',
      `      <xmin>${Math.round(box.x)}</xmin>`,
      `      <ymin>${Math.round(box.y)}</ymin>`,
      `      <xmax>${Math.round(box.x + box.width)}</xmax>`,
      `      <ymax>${Math.round(box.y + box.height)}</ymax>`,
      '    </bndbox>',
      '  </object>',
    ].join('\n');
  });
  return [
    '<annotation>',
    `  <folder>${xmlEscape(folderName)}</folder>`,
    `  <filename>${xmlEscape(doc.image.name)}</filename>`,
    '  <source><database>imagoLabel</database></source>',
    '  <size>',
    `    <width>${doc.image.width}</width>`,
    `    <height>${doc.image.height}</height>`,
    '    <depth>3</depth>',
    '  </size>',
    '  <segmented>0</segmented>',
    ...objects,
    '</annotation>',
    '',
  ].join('\n');
}

const csvCell = (value: string | number) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function csvRows(docs: ImageDoc[], classes: ClassDef[], classIndex: Map<string, number>, splits?: Map<string, string>) {
  const header = ['image', 'image_width', 'image_height', 'class', 'xmin', 'ymin', 'xmax', 'ymax', 'shape', 'polygon', 'source', 'score'];
  const rows = [(splits ? ['split', ...header] : header).join(',')];
  for (const doc of docs) {
    for (const a of exportable(doc, classIndex)) {
      const box = shapeBounds(a.shape);
      rows.push(
        [
          ...(splits ? [splits.get(doc.image.name) ?? 'train'] : []),
          csvCell(doc.image.name),
          doc.image.width,
          doc.image.height,
          csvCell(classes[classIndex.get(a.classId!)!].name),
          Math.round(box.x),
          Math.round(box.y),
          Math.round(box.x + box.width),
          Math.round(box.y + box.height),
          a.shape.type,
          csvCell(a.shape.type === 'polygon' ? a.shape.points.map(([x, y]) => `${Math.round(x)} ${Math.round(y)}`).join(' ') : ''),
          a.source,
          a.score === undefined ? '' : a.score.toFixed(3),
        ].join(','),
      );
    }
  }
  return rows.join('\n') + '\n';
}

/**
 * Deterministic train/val split: the same image always lands in the same set, so re-exporting
 * after annotating more images doesn't shuffle images between training and validation.
 */
export function isValidation(name: string, valPercent: number) {
  if (valPercent <= 0) return false;
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100) < valPercent;
}
