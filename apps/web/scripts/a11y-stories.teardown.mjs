import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Merges the stories sweep's shard results (#799) into the one
 * `a11y-results/stories.json` that `scripts/a11y-inventory.mjs` reads.
 * Runs are ordered by story file, so the merged file doesn't depend on
 * which shard finished first. With no shard results (every shard failed to
 * start) it writes nothing, and the run has already failed.
 */
export default function teardown() {
  const dir = path.join(import.meta.dirname, "..", "a11y-results");
  const shards = readdirSync(dir)
    .filter((f) => /^stories\.shard-\d+\.json$/.test(f))
    .map((f) => path.join(dir, f));
  if (shards.length === 0) return;
  const parts = shards.map((f) => JSON.parse(readFileSync(f, "utf8")));
  const runs = parts
    .flatMap((p) => p.runs)
    .map((run, i) => ({ run, i }))
    .sort(
      (a, b) =>
        a.run.context.file.localeCompare(b.run.context.file) || a.i - b.i
    )
    .map(({ run }) => run);
  const { tool, package: pkg, axeVersion } = parts[0];
  writeFileSync(
    path.join(dir, "stories.json"),
    `${JSON.stringify(
      {
        tool,
        package: pkg,
        generatedAt: new Date().toISOString(),
        axeVersion,
        runs,
      },
      null,
      2
    )}\n`
  );
  for (const f of shards) rmSync(f);
  console.log(
    `a11y:stories: merged ${shards.length} shard(s), ${runs.length} run(s) → a11y-results/stories.json`
  );
}
