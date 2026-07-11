/**
 * Output + exit-code contract (#190) — the sibling invariants (banner on
 * STDERR, payload/--json envelope on stdout) with the extended code map:
 * cli-env's 3–7 plus the app-data domain codes 8–9. See COMMANDS.md.
 */

import { envBanner, type EnvironmentDefinition } from "@portalai/cli-env";

export const EXIT_CODES: Record<string, number> = {
  ENV_NOT_CONFIGURED: 3,
  ENV_NOT_AUTHORIZED: 4,
  ENV_CONFIRMATION_REQUIRED: 5,
  ENV_DESTRUCTIVE_BLOCKED: 6,
  ENV_INFRA_ERROR: 7,
  ADMIN_NOT_FOUND: 8,
  ADMIN_CONFLICT: 9,
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
