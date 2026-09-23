import path from "node:path";

import { config as loadDotenv } from "dotenv";

import { getEnvironment } from "./registry.js";

/**
 * For a **local** env only, load `<packageDir>/.env` into `process.env`
 * (non-overriding). Convenience for operators/agents so a local CLI command
 * doesn't require `DATABASE_URL` (and, for `portalai login`, `AUTH0_*`) to be
 * exported by hand — the friction that surfaced running `--env local` from a
 * bare shell.
 *
 * **Scoped to local by construction.** Only local envs read connection config
 * from `process.env` — `connection.ts` (`DATABASE_URL`) and `auth0.ts`
 * (`AUTH0_*`) both gate that read on `!def.aws`. app-dev/prod compose everything
 * live from AWS SSM / Secrets Manager and never consult a `.env`, so a value
 * loaded here can never reach them; for those envs this is a no-op.
 *
 * **Per-package.** The `.env` lives in the invoking CLI's own package dir (each
 * CLI passes its own `packageDir`), never a shared or app file.
 *
 * **Non-overriding.** dotenv does not clobber an already-set var, so an explicit
 * shell export — or the target-env value the spawn layer injects — still wins.
 *
 * A missing `.env` is a silent no-op; an unknown env name is left for the normal
 * resolution path to reject with its typed error.
 */
export function loadLocalEnv(envName: string, packageDir: string): void {
  let isLocal: boolean;
  try {
    isLocal = !getEnvironment(envName).aws;
  } catch {
    return; // unknown env — let the caller's resolution surface the error
  }
  if (!isLocal) return;
  loadDotenv({ path: path.join(packageDir, ".env") });
}
