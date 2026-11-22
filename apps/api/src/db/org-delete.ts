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
import { ApplicationService } from "../services/application.service.js";
import {
  processIo,
  runDeleteScript,
  runIfMain,
  type DeleteScriptIo,
} from "./delete-script.util.js";

const USAGE = "Usage: db:org:delete -- --org <id> --actor <who>";

export type OrgDeleteIo = DeleteScriptIo;
export type OrgDeleteStep = typeof ApplicationService.deleteOrganization;

/** Parse, delete, report. Returns the exit code. */
export function runOrgDelete(
  argv: string[],
  remove: OrgDeleteStep = (id, actor) =>
    ApplicationService.deleteOrganization(id, actor),
  io: OrgDeleteIo = processIo
): Promise<number> {
  return runDeleteScript(argv, USAGE, remove, io);
}

runIfMain(import.meta.url, (argv) => runOrgDelete(argv));
