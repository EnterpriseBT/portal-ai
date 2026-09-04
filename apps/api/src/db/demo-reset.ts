/**
 * `db:demo:reset` (#509) — reset a demo org to the checked-in baseline, the
 * spawn target for the `portalai demo reset` CLI (via `runApiScript`).
 * Destructive; the CLI blocks it on prod.
 *
 * Usage: tsx src/db/demo-reset.ts --org <orgId> [--rows <n>]
 */
import { DemoSeedService } from "../services/demo-seed.service.js";
import { closeDatabase } from "./client.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const orgId = arg("--org");
  if (!orgId) {
    throw new Error("Usage: db:demo:reset -- --org <orgId> [--rows <n>]");
  }
  const rowsArg = arg("--rows");
  const rows = rowsArg !== undefined ? Number(rowsArg) : undefined;
  const result = await DemoSeedService.reset({ orgId, rows });
  console.log(JSON.stringify(result));
}

main()
  .then(async () => {
    await closeDatabase();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDatabase().catch(() => {});
    process.exit(1);
  });
