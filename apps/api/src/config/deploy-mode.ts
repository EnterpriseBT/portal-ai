/**
 * DEPLOY_MODE seam (#579) — one codebase, two deployment shapes.
 *
 * `saas` (default): multi-tenant + central — today's behavior, unchanged.
 * `residency`: single-tenant + self-contained in the customer's cloud —
 *   marketplace entitlement (not the Stripe webhook), the customer's own
 *   OIDC (not central Auth0), and no outbound call to our vendor infra.
 *
 * This module owns the mode accessors and the boot-time consistency guard.
 * The concrete residency behaviors land in sibling tickets (marketplace
 * source #568, OIDC provisioning #577, single-org seed #566/#583); this seam
 * is what they branch on. See `docs/DEPLOY_MODE_SEAM.discovery.md`.
 */

import { environment } from "../environment.js";

export type DeployMode = "saas" | "residency";

export const DEPLOY_MODES = ["saas", "residency"] as const;

/** Thrown by the boot guard on an unknown mode or a contradictory config. */
export class DeployModeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeployModeConfigError";
  }
}

/**
 * Validate a raw `DEPLOY_MODE` value. Empty/undefined defaults to `saas`;
 * an unrecognized value throws (caught by the boot guard for a clean exit).
 */
export function parseDeployMode(raw: string | undefined): DeployMode {
  if (!raw) return "saas";
  if ((DEPLOY_MODES as readonly string[]).includes(raw)) {
    return raw as DeployMode;
  }
  throw new DeployModeConfigError(
    `Unknown DEPLOY_MODE "${raw}" — expected one of: ${DEPLOY_MODES.join(", ")}`
  );
}

/**
 * The mode for this process, resolved leniently at module load so an import
 * never crashes: only an explicit `residency` is residency; anything else
 * (including a typo) reads as saas for *behavior*, and the boot guard below
 * rejects the typo with a clean fatal. Keeps unrecognized config fail-safe
 * (never accidentally residency) while still refusing to boot.
 */
export function isResidency(): boolean {
  return environment.DEPLOY_MODE === "residency";
}

export function isSaas(): boolean {
  return !isResidency();
}

/** The resolved mode, for logging/display. */
export const deployMode: DeployMode = isResidency() ? "residency" : "saas";

/** The subset of env the guard reads — injectable so tests need no reload. */
export interface DeployModeEnv {
  DEPLOY_MODE: string | undefined;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  OIDC_ISSUER: string;
  OIDC_AUDIENCE: string;
}

/**
 * Fail-closed boot guard: throws `DeployModeConfigError` if the mode is
 * unknown or the config contradicts the mode. Called first in `index.ts`
 * `start()` — a residency install that still carries central Stripe
 * credentials, or lacks its OIDC config, must refuse to boot rather than
 * run misconfigured (a silent phone-home is a compliance breach, not a
 * degraded feature). Pure; defaults to the real `environment`.
 */
export function assertDeployModeConsistency(
  env: DeployModeEnv = environment
): void {
  const mode = parseDeployMode(env.DEPLOY_MODE);
  const problems: string[] = [];

  if (mode === "residency") {
    if (env.STRIPE_SECRET_KEY || env.STRIPE_WEBHOOK_SECRET) {
      problems.push(
        "residency must not carry central Stripe credentials " +
          "(STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET); entitlement comes " +
          "from the marketplace, not the Stripe webhook"
      );
    }
    if (!env.OIDC_ISSUER || !env.OIDC_AUDIENCE) {
      problems.push(
        "residency requires OIDC_ISSUER and OIDC_AUDIENCE for the " +
          "customer's own identity provider"
      );
    }
  }

  if (problems.length > 0) {
    throw new DeployModeConfigError(
      `DEPLOY_MODE=${mode} config is inconsistent:\n- ${problems.join("\n- ")}`
    );
  }
}
