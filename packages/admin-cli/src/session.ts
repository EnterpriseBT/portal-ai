/**
 * The mutation session requirement (#190, confirmed in review).
 *
 * Mutations against staging/production require an active Auth0 device-flow
 * session (cli-env `getToken`) so every audit line attributes to a real
 * authenticated human — including when an AI agent drives the CLI inside a
 * session the human authorized. `local` (kind development) stays
 * frictionless: operator falls back to the OS username. No AWS SDK here.
 */

import os from "node:os";

import { getToken, EnvNotAuthorizedError } from "@portalai/cli-env";
import type { EnvironmentDefinition } from "@portalai/cli-env";

/** Attribution-only decode of the cached access token's `sub` (no verify —
 *  cli-env already owns the session's integrity). */
export function decodeSub(token: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8")
    ) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/**
 * The audit operator for a mutation. Staging/production: a device-flow
 * session is REQUIRED — none → ENV_NOT_AUTHORIZED naming `portalai login`.
 * Development: session `sub` if present, else the OS username.
 */
export async function requireMutationOperator(
  def: EnvironmentDefinition
): Promise<string> {
  if (def.kind === "development") {
    try {
      const sub = decodeSub(await getToken(def.name));
      if (sub) return sub;
    } catch {
      /* no local session is fine */
    }
    try {
      return os.userInfo().username;
    } catch {
      return "unknown";
    }
  }

  try {
    const sub = decodeSub(await getToken(def.name));
    if (sub) return sub;
  } catch {
    /* fall through to the typed error */
  }
  throw new EnvNotAuthorizedError(
    `Mutations against "${def.name}" require a device-flow session — run: portalai login --env ${def.name}`
  );
}
