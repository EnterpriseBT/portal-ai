// Regenerates `src/routeTree.gen.ts`, failing on any route file the generator
// rejects (#899).
//
// The Vite plugin runs the same generator but catches its error and only logs
// it, so `vite build` exits 0 and the tree silently stops updating: #896's
// 15 enum route ids went unregistered with every check green. A rejected file
// aborts the whole run, so the committed tree doesn't change either, and a
// diff of it alone can't tell. Called directly, the error propagates and this
// exits 1. Web's `build` runs it first.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Generator, getConfig } from "@tanstack/router-generator";

import { ROUTER_OPTIONS } from "./router-options.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  await new Generator({ config: getConfig(ROUTER_OPTIONS, root), root }).run();
} catch (err) {
  console.error(`generate-routes: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
