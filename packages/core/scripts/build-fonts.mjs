/**
 * TTF → WOFF2 conversion (#311).
 *
 * The marketing site is judged on first paint by strangers on unknown
 * networks, and these are variable fonts — the TTFs run 100–800 kB each.
 * WOFF2 typically cuts that by 50–70% for the same glyphs, which is the
 * single largest byte win available to a static page.
 *
 * The TTFs are still copied to `dist/fonts` by `build:assets` and stay in
 * every `src` list as the fallback, so nothing regresses if a consumer's
 * toolchain can't serve woff2.
 *
 * Runs after `build:assets` (it writes into the same `dist/fonts`), and is
 * idempotent: existing `.woff2` outputs are overwritten.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ttf2woff2 from "ttf2woff2";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src/assets/fonts");
const outDir = path.join(root, "dist/fonts");

fs.mkdirSync(outDir, { recursive: true });

const ttfs = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ttf"));
if (ttfs.length === 0) {
  console.error(`build:fonts — no .ttf files in ${srcDir}`);
  process.exit(1);
}

let totalTtf = 0;
let totalWoff2 = 0;

for (const file of ttfs) {
  const input = fs.readFileSync(path.join(srcDir, file));
  const output = ttf2woff2(input);
  const outName = `${file.replace(/\.ttf$/, "")}.woff2`;
  fs.writeFileSync(path.join(outDir, outName), output);

  totalTtf += input.length;
  totalWoff2 += output.length;
  const saved = Math.round((1 - output.length / input.length) * 100);
  console.log(
    `  ${outName}  ${kb(input.length)} → ${kb(output.length)}  (-${saved}%)`
  );
}

console.log(
  `build:fonts — ${ttfs.length} fonts, ${kb(totalTtf)} → ${kb(totalWoff2)} ` +
    `(-${Math.round((1 - totalWoff2 / totalTtf) * 100)}%)`
);

function kb(bytes) {
  return `${Math.round(bytes / 1024)}kB`;
}
