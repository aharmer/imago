// Draws imagoLabel's app icons (a dashed annotation box around a segmented shape) and writes them
// as PNGs. Run with `node scripts/make-icons.mjs` after changing the design.
import { deflateSync } from 'node:zlib';
import { crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKGROUND = [22, 24, 29];
const BODY = [37, 99, 235];
const HEAD = [91, 140, 255];
const BOX = [255, 176, 0];

function canvas(size) {
  const pixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    pixels.set(BACKGROUND, i * 4);
    pixels[i * 4 + 3] = 255;
  }
  const set = (x, y, colour) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    pixels.set(colour, i);
    pixels[i + 3] = 255;
  };
  return {
    pixels,
    ellipse(cx, cy, rx, ry, colour) {
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
        for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
          const dx = (x - cx) / rx;
          const dy = (y - cy) / ry;
          if (dx * dx + dy * dy <= 1) set(x, y, colour);
        }
      }
    },
    dashedRect(left, top, width, height, thickness, dash, gap, colour) {
      const on = (position) => position % (dash + gap) < dash;
      for (let t = 0; t < thickness; t++) {
        for (let x = left; x <= left + width; x++) {
          if (on(x - left)) {
            set(x, top + t, colour);
            set(x, top + height - t, colour);
          }
        }
        for (let y = top; y <= top + height; y++) {
          if (on(y - top)) {
            set(left + t, y, colour);
            set(left + width - t, y, colour);
          }
        }
      }
    },
  };
}

function png(size, pixels) {
  // Each row of a PNG image is prefixed with a filter byte; 0 means "no filter".
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function icon(size, padding) {
  const c = canvas(size);
  const inset = Math.round(size * padding);
  const inner = size - inset * 2;
  c.ellipse(size / 2, inset + inner * 0.62, inner * 0.26, inner * 0.32, BODY);
  c.ellipse(size / 2, inset + inner * 0.24, inner * 0.15, inner * 0.12, HEAD);
  c.dashedRect(
    inset + Math.round(inner * 0.1),
    inset + Math.round(inner * 0.05),
    Math.round(inner * 0.8),
    Math.round(inner * 0.9),
    Math.max(2, Math.round(size * 0.025)),
    Math.round(size * 0.07),
    Math.round(size * 0.05),
    BOX,
  );
  return png(size, c.pixels);
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon-192.png'), icon(192, 0.06));
writeFileSync(join(out, 'icon-512.png'), icon(512, 0.06));
// Maskable icons need their content inside a safe area, because launchers crop the edges.
writeFileSync(join(out, 'icon-maskable-512.png'), icon(512, 0.18));
console.log(`Wrote icons to ${out}`);
