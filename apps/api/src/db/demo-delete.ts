/**
 * `db:demo:delete` (#1035) — the full organization deletion (#197) for an org
 * `portalai demo create` made. The spawn target for `portalai demo delete`
 * (via `runApiScript`), which checks the marker in-process first so a refusal
 * reaches the operator with its own exit code; this re-checks it, since the
 * script can be run directly.
 *
 * Usage: tsx src/db/demo-delete.ts --org <id> --actor <who>
 *
 * Hard-deletes the org's content and tombstones the org row and its
 * memberships (`OrganizationDeleteService`): the same deletion an owner gets
 * from Settings, so a finished demo leaves no records or wide tables behind
 * and no owner keeps a deleted org as their current one.
 */
import { pathToFileURL } from "node:url";

import { ApplicationService } from "../services/application.service.js";
import { closeDatabase } from "./client.js";

const USAGE = "Usage: db:demo:delete -- --org <id> --actor <who>";

export interface DemoDeleteIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const processIo: DemoDeleteIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

export type DemoDeleteStep = typeof ApplicationService.deleteDemoOrganization;

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Parse, delete, report. Returns the exit code. */
export async function runDemoDelete(
  argv: string[],
  remove: DemoDeleteStep = (id, actor) =>
    ApplicationService.deleteDemoOrganization(id, actor),
  io: DemoDeleteIo = processIo
): Promise<number> {
  const orgId = arg(argv, "--org");
  const actor = arg(argv, "--actor");
  if (!orgId || !actor) {
    io.err(`${USAGE} (--org and --actor are required)`);
    return 1;
  }
  try {
    await remove(orgId, actor);
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 1;
  }
  io.out(JSON.stringify({ id: orgId, deleted: true }));
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runDemoDelete(process.argv.slice(2))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    })
    .then(async (code) => {
      await closeDatabase().catch(() => {});
      process.exit(code);
    });
}
