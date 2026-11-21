/**
 * `db:org:delete` (#1088) — the full organization deletion (#197) for any
 * live org. The spawn target for `portalai org delete` (via `runApiScript`),
 * which checks the org exists in-process first so a missing one reaches the
 * operator as not-found; this re-checks it, since the script can be run
 * directly.
 *
 * Usage: tsx src/db/org-delete.ts --org <id> --actor <who>
 *
 * Hard-deletes the org's content and tombstones the org row and its
 * memberships (`OrganizationDeleteService`), the same deletion an owner gets
 * from Settings. `org delete` used to tombstone the org row alone, which left
 * its members resolving to no current org and its data on disk for good.
 *
 * A sibling of `db:demo:delete` rather than a flag on it: that script only
 * removes an org `demo create` marked, which is what lets `demo delete` run
 * on prod, and that property shouldn't sit behind a switch.
 */
import { pathToFileURL } from "node:url";

import { ApplicationService } from "../services/application.service.js";
import { closeDatabase } from "./client.js";
import { parseFlags } from "./script-args.util.js";

const USAGE = "Usage: db:org:delete -- --org <id> --actor <who>";

export interface OrgDeleteIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const processIo: OrgDeleteIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

export type OrgDeleteStep = typeof ApplicationService.deleteOrganization;

/** Parse, delete, report. Returns the exit code. */
export async function runOrgDelete(
  argv: string[],
  remove: OrgDeleteStep = (id, actor) =>
    ApplicationService.deleteOrganization(id, actor),
  io: OrgDeleteIo = processIo
): Promise<number> {
  const args = parseFlags(argv, ["org", "actor"]);
  if (!args.ok) {
    io.err(`${USAGE} (${args.error})`);
    return 1;
  }
  const { org: orgId, actor } = args.flags;
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
  runOrgDelete(process.argv.slice(2))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    })
    .then(async (code) => {
      await closeDatabase().catch(() => {});
      process.exit(code);
    });
}
