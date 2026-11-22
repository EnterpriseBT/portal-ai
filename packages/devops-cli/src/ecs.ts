/**
 * The API one-offs `portalops` runs (#192, #581, #852): each is a built
 * apps/api script run with `node` in the env's API task, through cli-env's
 * `runApiTask` (moved there in #1088 so `portalai` routes its deletes the same
 * way). The runtime image has no npm (#573), so the command is the one each
 * script's `:ci` package script names.
 */

import {
  runApiTask,
  type ApiTaskResult,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

const SEED_COMMAND = ["node", "dist/db/seed.js"];
const UPGRADE_COMMAND = ["node", "dist/scripts/db-upgrade.js"];
const REDISPATCH_COMMAND = ["node", "dist/scripts/jobs-redispatch.js"];

export type SeedTaskResult = ApiTaskResult;
export type UpgradeTaskResult = ApiTaskResult;
export type RedispatchTaskResult = ApiTaskResult;

export function runSeedTask(
  def: EnvironmentDefinition
): Promise<SeedTaskResult> {
  return runApiTask(def, {
    command: SEED_COMMAND,
    label: "Seed",
    localHint: "seed local with `npm run db:seed` (apps/api)",
  });
}

export function runUpgradeTask(
  def: EnvironmentDefinition
): Promise<UpgradeTaskResult> {
  return runApiTask(def, {
    command: UPGRADE_COMMAND,
    label: "Upgrade",
    localHint: "upgrade local with `npm run db:upgrade` (apps/api)",
  });
}

/** Re-dispatch orphaned jobs after a Redis replacement (#852). The summary is
 *  in the task's CloudWatch log. */
export function runRedispatchTask(
  def: EnvironmentDefinition,
  opts: { dryRun: boolean }
): Promise<RedispatchTaskResult> {
  return runApiTask(def, {
    command: [...REDISPATCH_COMMAND, ...(opts.dryRun ? ["--dry-run"] : [])],
    label: "Redispatch",
    localHint: "run `npm run jobs:redispatch` (apps/api)",
  });
}
