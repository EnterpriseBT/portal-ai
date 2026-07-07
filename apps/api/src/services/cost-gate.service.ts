/**
 * Uniform tool cost gate (#169) — the enforcement half of the tool cost
 * contract. Every tool call routes through this gate at build time (see the
 * wrap in `ToolService.buildAnalyticsTools`); it computes a per-call unit cost
 * and charges/denies against the org's tier allocation (shipped #172:
 * `TierService.resolveTier`, `UsageService`, the `usage` table).
 *
 * See `docs/TOOL_COST_GATE.spec.md`.
 *
 * Slice 1 (this file, so far): the pure **units** helpers — `resolveCallCost`
 * + the `COST_RESOLVERS` registry + the `CostBearer` type. The
 * `CostGateService` class (resolve → rate → charge → deny) lands in slice 3.
 */

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
