import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Clears the previous run's results before the stories sweep (#799), so a
 * shard that crashes, or a shard count that shrank, can't leave stale runs
 * for `a11y-stories.teardown.mjs` to merge.
 */
export default function setup() {
  const dir = path.join(import.meta.dirname, "..", "a11y-results");
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) {
    if (f === "stories.json" || /^stories\.shard-\d+\.json$/.test(f))
      rmSync(path.join(dir, f));
  }
}
