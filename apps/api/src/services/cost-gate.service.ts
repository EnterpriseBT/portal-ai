/**
 * Uniform tool cost gate (#169) — the enforcement half of the tool cost
 * contract. Every tool call routes through this gate at build time (see the
 * wrap in `ToolService.buildAnalyticsTools`); it computes a per-call unit cost
 * and charges/denies against the org's tier allocation (shipped #172:
 * `TierService.resolveTier`, `UsageService`, the `usage` table).
 *
 * See `docs/TOOL_COST_GATE.spec.md`.
 */

import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";
import { DbService } from "./db.service.js";
import { TierService } from "./tier.service.js";
import { UsageService } from "./usage.service.js";
import { incrementRateWindow } from "../utils/rate-limit.util.js";
import type { CostHint } from "@portalai/core/models";

const logger = createLogger({ module: "cost-gate" });

/**
 * Who bears the third-party cost of a tool call.
 *
 * - `"application"` — Portal pays (built-in tools hitting a paid API like
 *   Tavily/geocoding, or heavy Portal compute) → **charged** against the tier.
 * - `"organization"` — the org hosts and pays (custom/webhook tools on the
 *   org's own endpoint) → **never charged** (`resolveCallCost` is irrelevant;
 *   the gate short-circuits to 0 units). The tool's `costHint` is surfaced to
 *   the agent as advisory context instead.
 *
 * The "who-pays rule": units meter *application*-incurred cost only.
 */
export type CostBearer = "application" | "organization";

/**
 * A per-tool unit-cost function for **application-paid** tools. Returns the
 * number of units a single call consumes. May be async so a fan-out tool can
 * read its input cardinality (e.g. `PortalSqlHandleService.getMeta(handle).rowCount`)
 * and return `f(N)`.
 */
export type CostResolver = (input: unknown) => number | Promise<number>;

/**
 * Registry of per-tool cost functions, keyed by tool name. Empty by default —
 * an unregistered app-paid tool costs the flat default of 1 unit per call
 * (`web_search`). Fan-out tools register `f(N)` here (e.g. `geocode` in #84).
 */
export const COST_RESOLVERS: Record<string, CostResolver> = {};

/** Register (or override) a tool's cost resolver. Idempotent by tool name. */
export function registerCostResolver(
  toolName: string,
  resolver: CostResolver
): void {
  COST_RESOLVERS[toolName] = resolver;
}

/**
 * Units a single call to `toolName` consumes, for **application-paid** tools.
 * Defaults to `1` for an unregistered tool (the flat metered/expensive cost);
 * a registered resolver may return `f(N)` (and may be async).
 *
 * Not called for `free` tools or `organization`-paid (custom) tools — the gate
 * short-circuits those before reaching here.
 */
export async function resolveCallCost(
  toolName: string,
  input: unknown
): Promise<number> {
  const resolver = COST_RESOLVERS[toolName];
  return resolver ? resolver(input) : 1;
}

/** Per-tool-call context the gate needs. Assembled by the `buildAnalyticsTools`
 *  wrap; `costHint`/`costBearer` come from the tool's capability/provenance. */
export interface CostGateContext {
  organizationId: string;
  toolName: string;
  costHint: CostHint;
  costBearer: CostBearer;
  input: unknown;
  actor: { userId: string };
  /** Injectable clock (ms) for deterministic tests. */
  now?: number;
}

/** A denial carries a typed error the wrap returns *as a tool result* (never a
 *  throw), so the agent relays it instead of the turn dying. */
export type Denial = {
  allowed: false;
  result: {
    error: { code: ApiCode; message: string; retryAfter?: number };
  };
};

/** A charge resolved at admission and applied at commit (#183) — carried from
 *  `checkAdmission` to `commitCharge` so the units aren't recomputed. */
export interface PendingCharge {
  organizationId: string;
  costClass: CostHint;
  units: number;
  actor: { userId: string };
}

/** The pre-flight verdict. `charge` is `null` for immune calls (free /
 *  org-paid / zero-unit) — nothing to commit on success. */
export type AdmissionResult =
  | { allowed: true; charge: PendingCharge | null }
  | Denial;

function deny(code: ApiCode, message: string, retryAfter?: number): Denial {
  return {
    allowed: false,
    result: {
      error: { code, message, ...(retryAfter != null ? { retryAfter } : {}) },
    },
  };
}

export class CostGateService {
  /**
   * Pre-flight admission (#183): decide whether a call may proceed, **without
   * charging**. Order: `free` immune → org-paid immune → estimate units →
   * per-minute rate (Redis, split-fail) → affordability (estimate ≤ remaining
   * allocation, the hard cap). Denials return a typed tool-result; infra errors
   * fail open. The charge lands later in `commitCharge`, only if the call
   * succeeds — a failed call is never charged.
   */
  static async checkAdmission(ctx: CostGateContext): Promise<AdmissionResult> {
    const now = ctx.now ?? Date.now();

    // free tools are immune to all gating — never charged, never denied.
    if (ctx.costHint === "free") return { allowed: true, charge: null };
    // who-pays: org-hosted (custom/webhook) tools are never charged.
    if (ctx.costBearer === "organization")
      return { allowed: true, charge: null };

    const units = await resolveCallCost(ctx.toolName, ctx.input);
    if (units <= 0) return { allowed: true, charge: null };

    try {
      const org = await DbService.repository.organizations.findById(
        ctx.organizationId
      );
      if (!org) return { allowed: true, charge: null }; // shouldn't happen; fail open

      const policy = await TierService.resolveTier(org, now);
      const alloc = policy.allocations[ctx.costHint];

      // rate (Redis) — split fail policy: a Redis outage fails open on the rate
      // check only; the affordability check below still enforces the quota.
      if (alloc.ratePerMin !== null) {
        try {
          const rate = await incrementRateWindow(
            `${ctx.organizationId}:${ctx.costHint}`,
            now
          );
          if (rate > alloc.ratePerMin) {
            return deny(
              ApiCode.TOOL_USAGE_RATE_LIMITED,
              `Rate limit reached for ${ctx.costHint} tools; retry in a moment.`,
              60
            );
          }
        } catch (err) {
          logger.warn(
            { err, tool: ctx.toolName, organizationId: ctx.organizationId },
            "rate limiter unavailable; allowing rate check (quota still enforced)"
          );
        }
      }

      // affordability — the estimated units must fit the remaining allocation.
      // This is the hard cap (denies before the call runs); no charge here.
      const balance = await UsageService.getBalance(org, policy, new Date(now));
      const { used, available } = balance.byClass[ctx.costHint];
      if (available !== null && units > available) {
        return deny(
          ApiCode.TOOL_USAGE_QUOTA_EXCEEDED,
          `Your plan's monthly ${ctx.costHint} allocation is exhausted (${used} used). It resets next billing period.`
        );
      }

      return {
        allowed: true,
        charge: {
          organizationId: ctx.organizationId,
          costClass: ctx.costHint,
          units,
          actor: ctx.actor,
        },
      };
    } catch (err) {
      // Uniform fail-open + log (a DB outage is total anyway).
      logger.warn(
        { err, tool: ctx.toolName, organizationId: ctx.organizationId },
        "cost gate admission infra error; failing open"
      );
      return { allowed: true, charge: null };
    }
  }

  /**
   * Commit a pending charge **after** the call succeeded (#183). Recomputes the
   * policy + period at `now` (so a long async job bills the completion period),
   * then applies the atomic conditional charge: if it would exceed the
   * allocation it is simply skipped — a free call, never a failure and never a
   * refund. No-op for a null charge. Never throws to the caller.
   */
  static async commitCharge(
    charge: PendingCharge | null,
    now: number = Date.now()
  ): Promise<void> {
    if (!charge || charge.units <= 0) return;

    try {
      const org = await DbService.repository.organizations.findById(
        charge.organizationId
      );
      if (!org) return;

      const policy = await TierService.resolveTier(org, now);
      const periodId = TierService.periodIdFor(policy.period, new Date(now));
      const alloc = policy.allocations[charge.costClass];

      // Atomic + conditional: lands only if within allocation, else skipped
      // (the completed call is free). Never negative, never a reversal.
      await UsageService.tryCharge(
        charge.organizationId,
        charge.costClass,
        charge.units,
        alloc.unitsPerPeriod,
        periodId,
        charge.actor
      );
    } catch (err) {
      logger.warn(
        {
          err,
          organizationId: charge.organizationId,
          costClass: charge.costClass,
        },
        "cost gate commit infra error; charge skipped"
      );
    }
  }
}

/** A tool object whose `execute` the gate wraps (structural — the AI SDK's
 *  `tool()` return). */
export type GateableTool = {
  execute?: (input: unknown, options: unknown) => unknown;
};

/** Per-tool cost metadata the wrap needs. */
export interface ToolCostMeta {
  costHint: CostHint;
  costBearer: CostBearer;
  /** true ⇒ an async-job tool (`resultKind: "progress"`) whose charge is
   *  committed by its job processor on job success — the wrap must NOT commit
   *  on `execute` return (enqueue-success ≠ work-completion). */
  deferChargeToJob: boolean;
}

/**
 * Decorate every tool's `execute` with the cost gate, **in place** (#183):
 * pre-flight `checkAdmission` before the call (deny ⇒ typed tool-result the
 * agent relays); run the original; on **success**, `commitCharge` the resolved
 * units — unless the tool defers to its job processor. A thrown `original`
 * skips the commit entirely, so a failed call is never charged.
 *
 * The `buildAnalyticsTools` guard test asserts no tool is left un-wrapped.
 */
export function wrapWithCostGate(
  tools: Record<string, GateableTool>,
  ctx: { organizationId: string; userId: string },
  metaFor: (toolName: string) => ToolCostMeta
): void {
  for (const [name, tool] of Object.entries(tools)) {
    const original = tool.execute;
    if (!original) continue;
    const { costHint, costBearer, deferChargeToJob } = metaFor(name);
    tool.execute = async (input: unknown, options: unknown) => {
      const admission = await CostGateService.checkAdmission({
        organizationId: ctx.organizationId,
        toolName: name,
        costHint,
        costBearer,
        input,
        actor: { userId: ctx.userId },
      });
      if (!admission.allowed) return admission.result;
      const result = await original(input, options);
      if (admission.charge && !deferChargeToJob) {
        await CostGateService.commitCharge(admission.charge);
      }
      return result;
    };
  }
}
