// Draws imagoLabel's app icon and writes it as PNGs.
// The mark: an imago (the adult insect) being annotated — one wing pair filled in as a segmentation
// mask, a traced outline with its points on the other, inside a dashed selection box.
// Run with `node scripts/make-icons.mjs` after changing the design.
import { crc32, deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INK = [255, 255, 255];
const WING = [28, 114, 135];
const WING_LIGHT = [43, 138, 154];
const BODY = [22, 92, 108];
const MARK = [228, 85, 39];

/** Everything is drawn at this multiple and averaged down, which gives smooth edges. */
const SUPERSAMPLE = 4;

function surface(size) {
  const pixels = new Float64Array(size * size * 3);
  const alpha = new Float64Array(size * size);

  const blend = (x, y, colour, a = 1) => {
    if (a <= 0 || x < 0 || y < 0 || x >= size || y >= size) return;
    const i = y * size + x;
    for (let c = 0; c < 3; c++) pixels[i * 3 + c] = pixels[i * 3 + c] * (1 - a) + colour[c] * a;
    alpha[i] = alpha[i] * (1 - a) + a;
  };

  const api = {
    pixels,
    alpha,
    fill(colour) {
      for (let i = 0; i < size * size; i++) {
        for (let c = 0; c < 3; c++) pixels[i * 3 + c] = colour[c];
        alpha[i] = 1;
      }
    },
    /** Rounded rectangle, used for the icon's background plate. */
    roundedRect(left, top, width, height, radius, colour) {
      for (let y = Math.floor(top); y < top + height; y++) {
        for (let x = Math.floor(left); x < left + width; x++) {
          const dx = Math.max(left + radius - x, x - (left + width - radius), 0);
          const dy = Math.max(top + radius - y, y - (top + height - radius), 0);
          if (Math.hypot(dx, dy) <= radius) blend(x, y, colour);
        }
      }
    },
    /** Ellipse, optionally rotated, optionally only its outline. */
    ellipse(cx, cy, rx, ry, rotation, colour, { stroke = 0 } = {}) {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const reach = Math.max(rx, ry) + stroke;
      for (let y = Math.floor(cy - reach); y <= cy + reach; y++) {
        for (let x = Math.floor(cx - reach); x <= cx + reach; x++) {
          const ox = x - cx;
          const oy = y - cy;
          const u = (ox * cos + oy * sin) / rx;
          const v = (-ox * sin + oy * cos) / ry;
          const d = Math.hypot(u, v);
          if (!stroke) {
            if (d <= 1) blend(x, y, colour);
          } else {
            // Approximate distance from the ellipse edge, in pixels.
            const edge = Math.abs(d - 1) * Math.min(rx, ry);
            if (edge <= stroke / 2) blend(x, y, colour);
          }
        }
      }
    },
    line(x1, y1, x2, y2, thickness, colour) {
      const minX = Math.floor(Math.min(x1, x2) - thickness);
      const maxX = Math.ceil(Math.max(x1, x2) + thickness);
      const minY = Math.floor(Math.min(y1, y2) - thickness);
      const maxY = Math.ceil(Math.max(y1, y2) + thickness);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lengthSq = dx * dx + dy * dy || 1;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSq));
          if (Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= thickness / 2) blend(x, y, colour);
        }
      }
    },
    curve(points, thickness, colour) {
      for (let i = 1; i < points.length; i++) api.line(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], thickness, colour);
    },
    polygon(points, colour) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of points) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      for (let y = Math.floor(minY); y <= maxY; y++) {
        for (let x = Math.floor(minX); x <= maxX; x++) {
          let inside = false;
          for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const [xi, yi] = points[i];
            const [xj, yj] = points[j];
            if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
          }
          if (inside) blend(x, y, colour);
        }
      }
    },
    square(cx, cy, half, colour) {
      for (let y = Math.round(cy - half); y <= cy + half; y++) {
        for (let x = Math.round(cx - half); x <= cx + half; x++) blend(x, y, colour);
      }
    },
    dashedRect(left, top, width, height, thickness, dash, gap, colour) {
      const on = (position) => position % (dash + gap) < dash;
      for (let x = Math.round(left); x <= left + width; x++) {
        if (!on(x - left)) continue;
        api.square(x, top, thickness / 2, colour);
        api.square(x, top + height, thickness / 2, colour);
      }
      for (let y = Math.round(top); y <= top + height; y++) {
        if (!on(y - top)) continue;
        api.square(left, y, thickness / 2, colour);
        api.square(left + width, y, thickness / 2, colour);
      }
    },
  };
  return api;
}

/** Average the supersampled drawing down to the final size. */
function downsample(big, size, factor) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const i = (y * factor + sy) * size * factor + (x * factor + sx);
          r += big.pixels[i * 3];
          g += big.pixels[i * 3 + 1];
          b += big.pixels[i * 3 + 2];
          a += big.alpha[i];
        }
      }
      const n = factor * factor;
      const i = (y * size + x) * 4;
      out[i] = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
      out[i + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
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

/**
 * @param size   final pixel size
 * @param inset  free space around the mark, as a fraction (maskable icons need more)
 * @param plate  draw the dark background plate (the app icon) or leave it transparent
 */
function icon(size, inset, plate = true) {
  const s = size * SUPERSAMPLE;
  const c = surface(s);
  const pad = s * inset;
  const inner = s - pad * 2;
  const u = inner / 100; // work in hundredths of the inner square
  const at = (x, y) => [pad + (50 + x) * u, pad + (50 + y) * u];

  if (plate) c.roundedRect(0, 0, s, s, s * 0.22, INK);

  const [cx, cy] = at(0, 2);
  // Wings: upper pair swept back, lower pair smaller. The left side is the filled "mask",
  // the right side is the traced outline, as if one half has been segmented and the other drawn.
  /**
   * One wing: a drop shape with its point at the body and its broad end sweeping outward.
   * `angle` is the direction it points; `length` and `width` are in hundredths of the square.
   */
  const wingOutline = (angle, length, width, steps = 80) => {
    const points = [];
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      // A cardioid: no radius at all at t = 0 (the point), swelling to full length opposite it.
      const r = (1 - Math.cos(t)) / 2;
      const px = r * length;
      const py = Math.sin(t) * width * (0.35 + 0.65 * r);
      points.push([cx + px * Math.cos(angle) - py * Math.sin(angle), cy + px * Math.sin(angle) + py * Math.cos(angle)]);
    }
    return points;
  };

  const wings = [
    // Angles point to the right-hand wing of each pair: upper swept up, lower swept down.
    { angle: -0.85, length: 44 * u, width: 20 * u, colour: WING_LIGHT },
    { angle: 0.95, length: 34 * u, width: 16 * u, colour: WING },
  ];
  for (const w of wings) {
    // Left wing filled in, like a segmentation mask; right wing traced, like a polygon.
    // Mirroring across the body negates the x direction, which is the same as π − angle.
    c.polygon(wingOutline(Math.PI - w.angle, w.length, w.width), w.colour);
    const traced = wingOutline(w.angle, w.length, w.width);
    c.curve([...traced, traced[0]], 3.4 * u, w.colour);
    for (let i = 0; i < 5; i++) {
      const [px, py] = traced[Math.round((i / 5) * traced.length) % traced.length];
      c.square(px, py, 2.9 * u, MARK);
    }
  }

  // Body, head and antennae.
  c.ellipse(cx, cy + 0.1 * u, 7 * u, 21 * u, 0, BODY);
  c.ellipse(cx, pad + 30 * u, 6.5 * u, 6 * u, 0, BODY);
  for (const side of [-1, 1]) {
    const tip = at(side * 11, -36);
    c.curve(
      [
        at(side * 3, -25),
        at(side * 9, -32),
        tip,
      ],
      2.4 * u,
      BODY,
    );
    c.ellipse(tip[0], tip[1], 2.6 * u, 2.6 * u, 0, BODY);
  }

  // The selection box around it, with corner handles.
  const left = pad + 6 * u;
  const top = pad + 8 * u;
  const width = inner - 12 * u;
  const height = inner - 16 * u;
  c.dashedRect(left, top, width, height, 3 * u, 9 * u, 6 * u, MARK);
  for (const [hx, hy] of [
    [left, top],
    [left + width, top],
    [left, top + height],
    [left + width, top + height],
  ]) {
    c.square(hx, hy, 4.4 * u, MARK);
  }

  return png(size, downsample(c, size, SUPERSAMPLE));
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon-192.png'), icon(192, 0.07));
writeFileSync(join(out, 'icon-512.png'), icon(512, 0.07));
// Maskable icons need their content inside a safe area, because launchers crop the edges.
writeFileSync(join(out, 'icon-maskable-512.png'), icon(512, 0.2));
console.log(`Wrote icons to ${out}`);
