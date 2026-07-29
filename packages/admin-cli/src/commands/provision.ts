/**
 * Spawn-backed commands (#190, Decision 4): `org create`, `org reset` and
 * `seed org` run the app's OWN scripts (`npm run --workspace @portalai/api …`)
 * with DATABASE_URL injected from the env connection — the app owns its
 * provisioning/reset/fixture semantics; the CLI owns env resolution, guards,
 * session, audit, UX. No cross-package runtime import.
 *
 * The spawner itself lives in `@portalai/cli-env` (#295) — `portalops db
 * seed --env local` runs the app's seed script the same way.
 */

import {
  npmSpawner,
  runApiScript,
  EnvInfraError,
  type WorkspaceSpawner,
} from "@portalai/cli-env";
import type { EnvironmentDefinition } from "@portalai/cli-env";

import { audit, beginMutation, type MutateFlags } from "./common.js";

export {
  npmSpawner,
  type SpawnResult,
  type WorkspaceSpawner,
} from "@portalai/cli-env";

/** The script's JSON result is its last parseable stdout line. */
function lastJsonLine(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split("\n").reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      /* keep looking */
    }
  }
  throw new EnvInfraError("Script produced no JSON result");
}

/** Full app provisioning for an EXISTING user — indistinguishable from a
 *  webhook-created org (column defs, sandbox, station, toolpack, …). */
export async function orgCreate(
  def: EnvironmentDefinition,
  opts: { name: string; ownerEmail: string },
  flags: MutateFlags,
  spawner: WorkspaceSpawner = npmSpawner
): Promise<Record<string, unknown>> {
  const operator = await beginMutation(def, flags, false);
  const stdout = await runApiScript(
    def,
    "db:create-org",
    ["--owner-email", opts.ownerEmail, "--name", opts.name],
    spawner
  );
  const result = lastJsonLine(stdout);
  await audit(def, operator, "org create", {
    name: opts.name,
    organizationId: result.organizationId,
  });
  return result;
}

/** Org-scoped app-data reset (the app's ResetService, via its own script). */
export async function orgReset(
  def: EnvironmentDefinition,
  orgId: string,
  flags: MutateFlags,
  spawner: WorkspaceSpawner = npmSpawner
): Promise<{ id: string; reset: true }> {
  const operator = await beginMutation(def, flags, true); // destructive
  await runApiScript(def, "db:reset", [orgId], spawner);
  await audit(def, operator, "org reset", { orgId });
  return { id: orgId, reset: true };
}

/** Idempotent org fixture with a synthetic owner; never production. */
export async function seedOrg(
  def: EnvironmentDefinition,
  opts: { name: string; memberEmail?: string },
  flags: MutateFlags,
  spawner: WorkspaceSpawner = npmSpawner
): Promise<Record<string, unknown>> {
  const operator = await beginMutation(def, flags, true); // destructive: synthetic data
  const args = ["--name", opts.name];
  if (opts.memberEmail) args.push("--member-email", opts.memberEmail);
  const stdout = await runApiScript(def, "db:seed:org", args, spawner);
  const result = lastJsonLine(stdout);
  await audit(def, operator, "seed org", {
    name: opts.name,
    organizationId: result.organizationId,
  });
  return result;
}
