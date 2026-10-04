import type { ActionGate } from "@portalai/core/ui";

/** The standard reason on an action the org's plan excludes. */
export const UPGRADE_REASON = "Available on a higher plan.";

/**
 * #688: everything that decides one action affordance. Callers feed it from
 * the row's `capabilities` (or a class-level `can(...)` for a create), the
 * tier's entitlements and the transient state shown nearby.
 */
export interface ActionGateInput {
  /** The permission: `capabilities.<verb>` or a class-level `can(...)`. */
  allowed: boolean;
  /** A page's primary action the caller could plausibly get (Create on an
   *  index page when they read the type): shown disabled, not hidden. */
  primary?: { plausible: boolean; grantHint: string };
  /** `false` when the org's tier excludes it (omit when not tier-gated). */
  entitled?: boolean;
  upgradeReason?: string;
  onUpgrade?: () => void;
  /** Transient state that blocks it (running job, pending save); null = none. */
  blocked?: string | null;
}

/**
 * Pure. Precedence is permission → tier → state, so the caller is told the
 * most durable reason: no amount of waiting fixes a missing permission, and
 * a plan upgrade is moot while a job holds the row.
 *
 * - Not permitted: hidden, unless it's a primary action the caller could
 *   plausibly be granted, which is disabled with the grant hint.
 * - Not entitled: an upsell. Without an `onUpgrade` there's nowhere to send
 *   the user, so it's disabled with the reason instead.
 * - Blocked: disabled, naming the state.
 */
export function decideActionGate(input: ActionGateInput): ActionGate {
  if (!input.allowed) {
    return input.primary?.plausible
      ? { kind: "disable", reason: input.primary.grantHint }
      : { kind: "hide" };
  }
  if (input.entitled === false) {
    const reason = input.upgradeReason ?? UPGRADE_REASON;
    return input.onUpgrade
      ? { kind: "upsell", reason, onUpgrade: input.onUpgrade }
      : { kind: "disable", reason };
  }
  if (input.blocked) {
    return { kind: "disable", reason: input.blocked };
  }
  return { kind: "allow" };
}
