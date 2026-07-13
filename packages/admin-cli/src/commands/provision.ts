/**
 * Spawn-backed commands (#190, Decision 4): `org create`, `org reset` and
 * `seed org` run the app's OWN scripts (`npm run --workspace @portalai/api …`)
 * with DATABASE_URL injected from the env connection — the app owns its
 * provisioning/reset/fixture semantics; the CLI owns env resolution, guards,
 * session, audit, UX. No cross-package runtime import.
 */

import { spawn } from "node:child_process";

import { resolveEnvConnection, EnvInfraError } from "@portalai/cli-env";
import type { EnvironmentDefinition } from "@portalai/cli-env";

import { audit, beginMutation, type MutateFlags } from "./common.js";

export interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type WorkspaceSpawner = (
  args: string[],
  env: Record<string, string>
) => Promise<SpawnResult>;

export const npmSpawner: WorkspaceSpawner = (args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", (e) =>
      reject(
        new EnvInfraError(`Failed to spawn npm: ${e.message}`, { cause: e })
      )
    );
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

/** Run an apps/api workspace script against the env's DB; returns stdout. */
async function runApiScript(
  def: EnvironmentDefinition,
  script: string,
  scriptArgs: string[],
  spawner: WorkspaceSpawner
): Promise<string> {
  const conn = await resolveEnvConnection(def.name);
  try {
    const db = await conn.db();
    const result = await spawner(
      ["run", "--workspace", "@portalai/api", script, "--", ...scriptArgs],
      { DATABASE_URL: db.connectionString }
    );
    if (result.code !== 0) {
      throw new EnvInfraError(
        `${script} failed (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`
      );
    }
    return result.stdout;
  } finally {
    await conn.dispose();
  }
}

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
