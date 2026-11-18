// Generates the PNG app icons with no dependencies (node:zlib only).
// Usage: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'icons'), { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [15, 17, 21];
const FG = [79, 179, 255];

// Dumbbell glyph in unit coordinates (0..1), scaled by `inset` for maskable safe zone.
function inDumbbell(u, v) {
  const rect = (x0, y0, x1, y1, r) => {
    const cx = Math.max(x0 + r, Math.min(u, x1 - r));
    const cy = Math.max(y0 + r, Math.min(v, y1 - r));
    return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
  };
  return rect(0.30, 0.47, 0.70, 0.53, 0.02) // bar
    || rect(0.20, 0.30, 0.30, 0.70, 0.03) || rect(0.70, 0.30, 0.80, 0.70, 0.03) // plates
    || rect(0.12, 0.38, 0.20, 0.62, 0.025) || rect(0.80, 0.38, 0.88, 0.62, 0.025); // outer plates
}

function make(size, { inset = 0, round = false }) {
  return png(size, (x, y, s) => {
    const nx = x / s, ny = y / s;
    if (round) {
      // rounded square mask (radius 22%) for non-maskable favicon-type icons
      const r = 0.22;
      const cx = Math.max(r, Math.min(nx, 1 - r)), cy = Math.max(r, Math.min(ny, 1 - r));
      if ((nx - cx) ** 2 + (ny - cy) ** 2 > r * r) return [0, 0, 0, 0];
    }
    const u = (nx - inset) / (1 - 2 * inset), v = (ny - inset) / (1 - 2 * inset);
    // simple 3x3 supersampling for smoother edges
    let hits = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const du = (i - 1) / (3 * s * (1 - 2 * inset)), dv = (j - 1) / (3 * s * (1 - 2 * inset));
      if (inDumbbell(u + du, v + dv)) hits++;
    }
    const t = hits / 9;
    return [
      Math.round(BG[0] + (FG[0] - BG[0]) * t),
      Math.round(BG[1] + (FG[1] - BG[1]) * t),
      Math.round(BG[2] + (FG[2] - BG[2]) * t), 255];
  });
}

writeFileSync(join(root, 'icons/apple-touch-icon.png'), make(180, { inset: 0.06 }));
writeFileSync(join(root, 'icons/icon-192.png'), make(192, { inset: 0.04, round: true }));
writeFileSync(join(root, 'icons/icon-512.png'), make(512, { inset: 0.04, round: true }));
writeFileSync(join(root, 'icons/icon-maskable-512.png'), make(512, { inset: 0.14 }));
console.log('Icons written to icons/');
