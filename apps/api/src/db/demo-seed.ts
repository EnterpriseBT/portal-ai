/**
 * `db:demo:seed` (#509) — populate a demo org from the committed dataset, the
 * spawn target for the `portalai demo seed` CLI (via `runApiScript`).
 *
 * Usage: tsx src/db/demo-seed.ts --org <orgId> [--rows <n>]
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
    throw new Error("Usage: db:demo:seed -- --org <orgId> [--rows <n>]");
  }
  const rowsArg = arg("--rows");
  const rows = rowsArg !== undefined ? Number(rowsArg) : undefined;
  const result = await DemoSeedService.seed({ orgId, rows });
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
