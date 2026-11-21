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
import { ApplicationService } from "../services/application.service.js";
import {
  processIo,
  runDeleteScript,
  runIfMain,
  type DeleteScriptIo,
} from "./delete-script.util.js";

const USAGE = "Usage: db:demo:delete -- --org <id> --actor <who>";

export type DemoDeleteIo = DeleteScriptIo;
export type DemoDeleteStep = typeof ApplicationService.deleteDemoOrganization;

/** Parse, delete, report. Returns the exit code. */
export function runDemoDelete(
  argv: string[],
  remove: DemoDeleteStep = (id, actor) =>
    ApplicationService.deleteDemoOrganization(id, actor),
  io: DemoDeleteIo = processIo
): Promise<number> {
  return runDeleteScript(argv, USAGE, remove, io);
}

runIfMain(import.meta.url, (argv) => runDemoDelete(argv));
