/**
 * Run an `apps/api` workspace script against an environment's database
 * (#190 Decision 4, generalized in #295).
 *
 * The app owns its provisioning / reset / seed semantics; the CLI owns env
 * resolution, guards, session and audit. So the CLIs spawn the app's OWN
 * npm scripts with `DATABASE_URL` injected from the env connection rather
 * than importing anything out of `apps/api` — there is no cross-package
 * runtime import in either direction.
 *
 * Injection wins over the script's own `dotenv -e .env` prefix: dotenv does
 * not overwrite a variable already present in the environment, so
 * `--env app-dev` reaches app-dev and never the local `.env` database.
 *
 * Callers: `portalai org create` / `org reset` / `seed org` (#190) and
 * `portalops db seed --env local` (#295).
 */

import { spawn } from "node:child_process";

import { resolveEnvConnection } from "./connection.js";
import { EnvInfraError } from "./errors.js";
import type { EnvironmentDefinition } from "./registry.js";

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
export async function runApiScript(
  def: EnvironmentDefinition,
  script: string,
  scriptArgs: string[],
  spawner: WorkspaceSpawner = npmSpawner
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
