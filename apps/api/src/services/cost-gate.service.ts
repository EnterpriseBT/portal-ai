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
export function registerCostResolver(toolName: string, resolver: CostResolver): void {
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

/** A deny carries a typed error the wrap returns *as a tool result* (never a
 *  throw), so the agent relays it instead of the turn dying. */
export type GateResult =
  | { allowed: true }
  | {
      allowed: false;
      result: {
        error: { code: ApiCode; message: string; retryAfter?: number };
      };
    };

function deny(
  code: ApiCode,
  message: string,
  retryAfter?: number
): GateResult {
  return {
    allowed: false,
    result: {
      error: { code, message, ...(retryAfter != null ? { retryAfter } : {}) },
    },
  };
}

export class CostGateService {
  /**
   * Decide whether a tool call may proceed, charging the org's allocation when
   * it does. Order: `free` immune → org-paid (custom) immune → resolve units →
   * per-minute rate (Redis) → per-period quota charge (DB, atomic). Denials
   * return a typed tool-result; infra errors **fail open** + log (the Postgres
   * quota still caps spend when Redis is down; a DB outage is total anyway).
   */
  static async resolveCostGate(ctx: CostGateContext): Promise<GateResult> {
    const now = ctx.now ?? Date.now();

    // free tools are immune to all gating — never charged, never denied.
    if (ctx.costHint === "free") return { allowed: true };
    // who-pays: org-hosted (custom/webhook) tools are never charged.
    if (ctx.costBearer === "organization") return { allowed: true };

    const units = await resolveCallCost(ctx.toolName, ctx.input);
    if (units <= 0) return { allowed: true };

    try {
      const org = await DbService.repository.organizations.findById(
        ctx.organizationId
      );
      if (!org) return { allowed: true }; // shouldn't happen; fail open

      const policy = await TierService.resolveTier(org, now);
      const periodId = TierService.periodIdFor(policy.period, new Date(now));
      const alloc = policy.allocations[ctx.costHint];

      // rate (Redis) — cheap, checked first; a rate denial does not charge.
      // Split fail policy: the rate check is isolated in its own try/catch so
      // a Redis outage fails open on *rate only* and still falls through to the
      // Postgres quota charge below — the quota remains the spend backstop when
      // Redis is down (see rate-limit.util.ts). Only a DB failure fails the
      // whole gate open (outer catch).
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

      // quota (DB, atomic) — charge only if within the allocation.
      const charge = await UsageService.tryCharge(
        ctx.organizationId,
        ctx.costHint,
        units,
        alloc.unitsPerPeriod,
        periodId,
        ctx.actor
      );
      if (!charge.allowed) {
        return deny(
          ApiCode.TOOL_USAGE_QUOTA_EXCEEDED,
          `Your plan's monthly ${ctx.costHint} allocation is exhausted (${charge.used} used). It resets next billing period.`
        );
      }

      return { allowed: true };
    } catch (err) {
      // D6 — uniform fail-open + log.
      logger.warn(
        { err, tool: ctx.toolName, organizationId: ctx.organizationId },
        "cost gate infra error; failing open"
      );
      return { allowed: true };
    }
  }
}

/** A tool object whose `execute` the gate wraps (structural — the AI SDK's
 *  `tool()` return). */
export type GateableTool = {
  execute?: (input: unknown, options: unknown) => unknown;
};

/** Per-tool cost metadata the wrap needs: its cost class and who pays. */
export interface ToolCostMeta {
  costHint: CostHint;
  costBearer: CostBearer;
}

/**
 * Decorate every tool's `execute` with the cost gate, **in place**. On each
 * call the wrap runs `resolveCostGate`; on deny it returns the typed
 * deny-result (delivered as a tool-result the agent relays), otherwise it
 * delegates to the original `execute`. `metaFor` supplies each tool's cost
 * class + bearer (built-in ⇒ application; org toolpack ⇒ organization).
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
    const { costHint, costBearer } = metaFor(name);
    tool.execute = async (input: unknown, options: unknown) => {
      const gate = await CostGateService.resolveCostGate({
        organizationId: ctx.organizationId,
        toolName: name,
        costHint,
        costBearer,
        input,
        actor: { userId: ctx.userId },
      });
      if (!gate.allowed) return gate.result;
      return original(input, options);
    };
  }
}
