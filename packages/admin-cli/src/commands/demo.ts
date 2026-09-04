/**
 * Demo-org seeding commands (#509): `portalai demo seed` / `demo reset`.
 *
 * Spawn-backed like `provision.ts` — the app's `db:demo:seed` / `db:demo:reset`
 * scripts own the seeding/reset semantics (records through the real import
 * path, toolpacks, the ~1M transactions); the CLI owns env resolution, guards,
 * session and audit. No cross-package runtime import.
 *
 * Guard semantics (#509 Decision 4):
 *   - `demo seed` is **non-destructive** — it converges data, so prod is
 *     reachable with `--yes --confirm-prod` (the documented prod refresh path).
 *   - `demo reset` is **destructive** — prod-blocked (exit 6); app-dev needs
 *     `--yes`.
 *
 * `DEMO_TOOLPACK_URL` (the shared #510 endpoint) is not a flag: it flows to the
 * spawned script via the environment (operator shell or apps/api `.env`;
 * managed per env in SSM via `portalops vars`), keeping admin-cli infra-free.
 */

import {
  npmSpawner,
  runApiScript,
  type WorkspaceSpawner,
} from "@portalai/cli-env";
import type { EnvironmentDefinition } from "@portalai/cli-env";

import { audit, beginMutation, type MutateFlags } from "./common.js";
import { lastJsonLine } from "./provision.js";

export async function demoSeed(
  def: EnvironmentDefinition,
  opts: { orgId: string; rows?: number },
  flags: MutateFlags,
  spawner: WorkspaceSpawner = npmSpawner
): Promise<Record<string, unknown>> {
  // Non-destructive convergence — prod allowed with --yes --confirm-prod.
  const operator = await beginMutation(def, flags, false);
  const args = ["--org", opts.orgId];
  if (opts.rows !== undefined) args.push("--rows", String(opts.rows));
  const stdout = await runApiScript(def, "db:demo:seed", args, spawner);
  const result = lastJsonLine(stdout);
  await audit(def, operator, "demo seed", {
    orgId: opts.orgId,
    rows: opts.rows ?? null,
  });
  return result;
}

export async function demoReset(
  def: EnvironmentDefinition,
  opts: { orgId: string; rows?: number },
  flags: MutateFlags,
  spawner: WorkspaceSpawner = npmSpawner
): Promise<Record<string, unknown>> {
  // Destructive — prod-blocked by the guard.
  const operator = await beginMutation(def, flags, true);
  const args = ["--org", opts.orgId];
  if (opts.rows !== undefined) args.push("--rows", String(opts.rows));
  const stdout = await runApiScript(def, "db:demo:reset", args, spawner);
  const result = lastJsonLine(stdout);
  await audit(def, operator, "demo reset", { orgId: opts.orgId });
  return result;
}
