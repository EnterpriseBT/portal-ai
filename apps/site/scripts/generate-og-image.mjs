/**
 * Generates `public/og-default.png` — the share card every page's OG and
 * Twitter tags point at (#311).
 *
 * Generated rather than committed as an opaque binary, and drawn from the
 * SAME theme JSON the site's palette comes from, so it can't drift from the
 * brand the way a hand-exported asset does.
 *
 * Deliberately typographic-free: rendering text needs a font rasteriser, and
 * a wrong-font wordmark looks worse than none. This is a correct, on-brand
 * placeholder that makes shares render properly; a designed card should
 * replace it before launch (tracked in the README).
 *
 * Pure Node — writes the PNG by hand (zlib is the only thing needed).
 *
 *   node scripts/generate-og-image.mjs
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import { readThemes } from "./generate-tokens.mjs";

const WIDTH = 1200;
const HEIGHT = 630;

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(here, "../public/og-default.png");

const { dark } = readThemes();
const background = hexToRgb(dark.palette.background.default);
const primary = hexToRgb(dark.palette.primary.main);
const secondary = hexToRgb(dark.palette.secondary.main);

/** `#rrggbb` → `[r, g, b]`. */
function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

const mix = (a, b, t) => a.map((channel, i) => Math.round(channel + (b[i] - channel) * t));

/**
 * A soft diagonal wash from the brand primary into the dark background,
 * with a solid accent bar along the bottom edge.
 */
function pixel(x, y) {
  const BAR = 14;
  if (y >= HEIGHT - BAR) {
    return mix(primary, secondary, x / WIDTH);
  }

  // Diagonal falloff, strongest at the top-left.
  const t = (x / WIDTH) * 0.6 + (y / HEIGHT) * 0.4;
  const wash = Math.max(0, 1 - t) ** 2 * 0.55;
  return mix(background, primary, wash);
}

// ── Raw scanlines (filter byte 0 + RGB triples) ──────────────────────
const raw = Buffer.alloc(HEIGHT * (1 + WIDTH * 3));
let offset = 0;
for (let y = 0; y < HEIGHT; y++) {
  raw[offset++] = 0; // filter: none
  for (let x = 0; x < WIDTH; x++) {
    const [r, g, b] = pixel(x, y);
    raw[offset++] = r;
    raw[offset++] = g;
    raw[offset++] = b;
  }
}

// ── PNG container ────────────────────────────────────────────────────
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: truecolour RGB
// 10-12: compression, filter, interlace — all 0.

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, png);
console.log(
  `generate-og-image — ${WIDTH}×${HEIGHT} → ${outPath} (${Math.round(png.length / 1024)}kB)`
);
