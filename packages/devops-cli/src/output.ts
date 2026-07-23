/**
 * Output + exit-code contract (#192) — the agent-facing invariants:
 * the active-env banner goes to STDERR (stdout stays clean for --json /
 * piping), and every CliEnvError code maps to a stable exit code.
 */

import { envBanner, type EnvironmentDefinition } from "@portalai/cli-env";

/** The published exit-code contract (see COMMANDS.md). */
export const EXIT_CODES: Record<string, number> = {
  ENV_NOT_CONFIGURED: 3,
  ENV_NOT_AUTHORIZED: 4,
  ENV_CONFIRMATION_REQUIRED: 5,
  ENV_DESTRUCTIVE_BLOCKED: 6,
  ENV_INFRA_ERROR: 7,
  // Not-found family (mirrors admin-cli's 8): a declared tier's Stripe
  // lookup key resolves to no price in the env's account (#254); or a
  // `tier update`/`tier description` targets a slug that doesn't exist (#241).
  TIER_APPLY_MISSING_PRICES: 8,
  TIER_NOT_FOUND: 8,
  // Conflict family (mirrors admin-cli's 9): `tier create` targets a slug
  // that already exists (#241).
  TIER_ALREADY_EXISTS: 9,
};

export function exitCodeFor(err: unknown): number {
  const code = (err as { code?: string })?.code;
  return (code && EXIT_CODES[code]) || 1;
}

/** Echo the active env on stderr — every command does this first. */
export function printBanner(def: EnvironmentDefinition): void {
  process.stderr.write(`${envBanner(def)}\n`);
}

/** The --json error envelope (stdout). */
export function jsonError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  return JSON.stringify({
    error: { code: e?.code ?? "UNKNOWN", message: e?.message ?? String(err) },
  });
}
