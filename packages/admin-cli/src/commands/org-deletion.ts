/**
 * Run one of the app's org-deleting scripts against an env (#1088):
 * `org-delete` (`portalai org delete`) or `demo-delete` (`portalai demo
 * delete`, #1035). Both run the full organization deletion (#197), which is
 * more than SQL: it cancels queued jobs in the env's BullMQ, deletes uploads
 * from its S3 bucket and cancels its Stripe subscription.
 *
 * Routed by env shape, as `portalops db seed` / `db upgrade` are:
 *
 * - **An env with `aws`** runs the built script as an ECS one-off in the env's
 *   API task, which carries that env's Redis, S3 and Stripe config. A local
 *   spawn gets only the env's database, encryption key and system id and
 *   takes the rest from the operator's own `.env`, so it cancelled jobs in
 *   the operator's Redis, deleted from the operator's bucket and called the
 *   operator's Stripe account, while reporting success (#1088 review).
 * - **`local`** spawns the npm script, whose `.env` is that env's.
 *
 * A failure surfaces as the env's infra error (exit 7) carrying the script's
 * own reason, read from the task's CloudWatch log on AWS envs.
 */

import {
  npmSpawner,
  runApiScript,
  runApiTask,
  type EnvironmentDefinition,
  type WorkspaceSpawner,
} from "@portalai/cli-env";

import { lastJsonLine } from "./provision.js";

export type OrgDeletionScript = "org-delete" | "demo-delete";

const LABELS: Record<OrgDeletionScript, string> = {
  "org-delete": "Org delete",
  "demo-delete": "Demo delete",
};

const NPM_SCRIPTS: Record<OrgDeletionScript, string> = {
  "org-delete": "db:org:delete",
  "demo-delete": "db:demo:delete",
};

export async function runOrgDeletion(
  def: EnvironmentDefinition,
  script: OrgDeletionScript,
  orgId: string,
  operator: string,
  spawner: WorkspaceSpawner = npmSpawner
): Promise<Record<string, unknown>> {
  const args = ["--org", orgId, "--actor", operator];
  if (def.aws) {
    await runApiTask(def, {
      command: ["node", `dist/db/${script}.js`, ...args],
      label: LABELS[script],
      localHint: `run \`npm run ${NPM_SCRIPTS[script]}\` (apps/api)`,
    });
    // The script's JSON line is in CloudWatch; a zero exit is the success
    // it reports, so the result is built here rather than read back.
    return { id: orgId, deleted: true };
  }
  const stdout = await runApiScript(def, NPM_SCRIPTS[script], args, spawner);
  return lastJsonLine(stdout);
}
