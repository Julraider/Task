#!/usr/bin/env node
'use strict';

/**
 * Erzeugt die App-Icons (assets/icon.png, assets/tray.png) ohne externe
 * Abhaengigkeiten - reines Node mit zlib als PNG-Encoder.
 *
 *   npm run icons
 *
 * Wer ein eigenes Icon hat: einfach die PNGs in assets/ ersetzen, dann wird
 * dieses Skript nicht mehr gebraucht.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ------------------------------------------------------------- PNG-Encoder

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** rgba: Buffer mit size*size*4 Bytes */
function encodePng(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // no interlace

  // Scanlines mit Filter-Byte 0 davor
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- Zeichnen

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** Abstand Punkt -> Strecke */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : clamp01(((px - ax) * dx + (py - ay) * dy) / lenSq);
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Signed distance eines abgerundeten Rechtecks (negativ = innen) */
function roundedRectSdf(px, py, halfW, halfH, radius) {
  const qx = Math.abs(px) - halfW + radius;
  const qy = Math.abs(py) - halfH + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Deckung aus einer Signed Distance (weiche Kante ueber ~1px) */
function coverage(sdf, aa) {
  return clamp01(0.5 - sdf / aa);
}

function blend(dst, i, r, g, b, a) {
  if (a <= 0) return;
  const da = dst[i + 3] / 255;
  const outA = a + da * (1 - a);
  if (outA <= 0) {
    dst[i] = dst[i + 1] = dst[i + 2] = dst[i + 3] = 0;
    return;
  }
  dst[i] = Math.round((r * a + dst[i] * (da * (1 - a))) / outA);
  dst[i + 1] = Math.round((g * a + dst[i + 1] * (da * (1 - a))) / outA);
  dst[i + 2] = Math.round((b * a + dst[i + 2] * (da * (1 - a))) / outA);
  dst[i + 3] = Math.round(outA * 255);
}

/**
 * Icon: abgerundetes Quadrat im Akzentblau mit weissem Haken.
 * Alles in Einheitskoordinaten (0..1), damit jede Groesse gleich aussieht.
 */
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const aa = 1 / size; // eine Pixelbreite in Einheitskoordinaten

  const check = [
    [0.27, 0.53],
    [0.43, 0.69],
    [0.75, 0.33],
  ];
  const strokeHalf = 0.055;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / size;
      const py = (y + 0.5) / size;
      const i = (y * size + x) * 4;

      // Hintergrund
      const bg = coverage(roundedRectSdf(px - 0.5, py - 0.5, 0.44, 0.44, 0.14), aa);
      if (bg > 0) {
        // sanfter Verlauf von oben (heller) nach unten (dunkler)
        const t = clamp01(py);
        const r = Math.round(88 + (58 - 88) * t);
        const g = Math.round(122 + (86 - 122) * t);
        const b = Math.round(255 + (214 - 255) * t);
        blend(rgba, i, r, g, b, bg);
      }

      // Haken
      let d = Infinity;
      for (let s = 0; s < check.length - 1; s++) {
        d = Math.min(d, distToSegment(px, py, check[s][0], check[s][1], check[s + 1][0], check[s + 1][1]));
      }
      const stroke = coverage(d - strokeHalf, aa);
      if (stroke > 0) blend(rgba, i, 255, 255, 255, stroke);
    }
  }

  return rgba;
}

// ------------------------------------------------------------------- Main

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { file: 'icon.png', size: 512 },
  { file: 'tray.png', size: 32 },
  { file: 'tray@2x.png', size: 64 },
];

for (const { file, size } of targets) {
  const png = encodePng(drawIcon(size), size);
  fs.writeFileSync(path.join(outDir, file), png);
  console.log(`assets/${file}  (${size}x${size}, ${png.length} Bytes)`);
}
