# Uniform tool cost gate — Spec

**Issue:** [EnterpriseBT/portal-ai#169](https://github.com/EnterpriseBT/portal-ai/issues/169) · **Epic:** #177 · **Discovery:** `docs/TOOL_COST_GATE.discovery.md`

Add the **enforcement half** of the tool cost contract: a `resolveCostGate` every tool call routes through at build time. On each call it resolves the org's `TierPolicy` (shipped #172), computes a per-call unit cost, **atomically charges the org's `usage` allocation** and **denies** (as a typed tool *result*, not a throw) when the quota or per-minute rate would be exceeded. Built on the seams #172 shipped (`TierService.resolveTier`, `UsageService`, the `usage` table); adds **no new table** (the per-call audit ledger is deferred to #179).

Discovery decisions ratified here:

- **D1 — build-time wrap.** `buildAnalyticsTools` decorates every tool's `execute`; a guard test asserts none is un-wrapped.
- **D2 — quota = DB-atomic conditional charge** (`UsageService.tryCharge` against #172's `usage`); **rate = Redis** short-window counter. No Redis quota store, no Lua.
- **D8 — units, not calls.** `resolveCallCost(tool, input) → units` (flat = `weight 1`; fan-out = `f(N)` via `getMeta`). No reconcile phase.
- **Who-pays rule** — units meter *application*-incurred cost. Built-ins hitting Portal-paid third parties charge; **custom/webhook tools are org-hosted → `0` units, never charged**; their `costHint` is surfaced to the agent as advisory context.
- **D5 — `expensive` ack handshake stays tool-local** (`CostAcknowledgementService` unchanged); the gate additionally charges `expensive` against the allocation.
- **D6 — uniform fail-open + log** on infra error (Redis or DB); quota is DB-backed so a Redis outage only drops the rate check.
- **Free tools immune** — never charged, never denied, no rate limit (short-circuit before any resolve/charge).
- **Deny → typed tool result** (`TOOL_USAGE_RATE_LIMITED` / `TOOL_USAGE_QUOTA_EXCEEDED`), delivered as a `tool-result` chunk the model relays.

---

## Scope

### In scope

1. **`ApiCode`s** `TOOL_USAGE_RATE_LIMITED`, `TOOL_USAGE_QUOTA_EXCEEDED` (`api-codes.constants.ts`).
2. **`UsageService.tryCharge` + `UsageRepository.chargeConditional`** — an atomic conditional charge against the shipped `usage` table (increments only if within allocation).
3. **`CostGateService`** (`services/cost-gate.service.ts`) — `resolveCostGate(ctx)` (the class check + who-pays + rate + quota charge + deny-result) and `resolveCallCost(toolName, input)` (per-tool units).
4. **Redis rate-limit util** — fixed-window per-minute counter.
5. **The build-time wrap** in `ToolService.buildAnalyticsTools` — decorate every entry's `execute`; track which entries are custom (org-paid).
6. **`web_search` as the first guarded `metered` tool** — proves the gate end-to-end.
7. **Advisory `costHint` to the agent** for custom tools (`system.prompt.ts` / tool description) — advisory, not a gate.
8. **Docs** — `CUSTOM_TOOLPACK_INTEGRATION.md`, README/CLAUDE.md cost-control convention.

### Out of scope

- **Tier model, `usage` balance, Settings display** — shipped #172.
- **Per-call audit ledger + chargeback + analytics** — #179 (post-Stripe #176).
- **Payment provider** — #176.
- **A declared per-tool `unitCost` field on `ToolCapabilitySchema`** — v1 uses an api-side `resolveCallCost` registry + the who-pays binary; a declared cost field is a later refinement.
- **Per-row metering of a built-in metered tool used as a bulk expression** — charged once at the outer `transform_entity_records` call (discovery Open Q7).

---

## Surface

### Error codes

**`apps/api/src/constants/api-codes.constants.ts`** — after the `TIER_DEFAULT_MISSING` block:

```ts
// Tool cost gate (#169)
/** Per-minute rate limit for the org's tier exceeded for this cost class. 429-class. */
TOOL_USAGE_RATE_LIMITED = "TOOL_USAGE_RATE_LIMITED",
/** The org's billing-period unit allocation for this cost class is exhausted. 402/429-class. */
TOOL_USAGE_QUOTA_EXCEEDED = "TOOL_USAGE_QUOTA_EXCEEDED",
```

### Atomic conditional charge

**`apps/api/src/db/repositories/usage.repository.ts`** — add alongside `increment`:

```ts
/**
 * Atomically charge `units` to `(org, period, costClass)` **only if** the
 * post-charge total stays within `allocation`. Returns the new `unitsUsed` on
 * success, or `null` if the charge would exceed the allocation (denied).
 * `allocation === null` means unlimited → always charges.
 *
 * The conditional UPDATE is atomic per row (row lock), so concurrent charges
 * serialize and cannot overshoot. The seed-INSERT is idempotent.
 */
async chargeConditional(
  row: UsageInsert,               // full row incl. baseColumns + org/period/class; unitsUsed = the charge
  allocation: number | null,
  client: DbClient = db
): Promise<number | null> {
  const units = row.unitsUsed ?? 0;
  return DbService.transaction(async (tx) => {
    // 1. ensure the (org,period,class) row exists at 0 (idempotent)
    await tx.insert(usage)
      .values({ ...row, unitsUsed: 0 })
      .onConflictDoNothing({
        target: [usage.organizationId, usage.periodId, usage.costClass],
        targetWhere: isNull(usage.deleted),
      });
    // 2. atomic conditional increment
    const guard = allocation === null
      ? sql`TRUE`
      : sql`${usage.unitsUsed} + ${units} <= ${allocation}`;
    const [updated] = await tx.update(usage)
      .set({ unitsUsed: sql`${usage.unitsUsed} + ${units}`, updated: row.created, updatedBy: row.createdBy })
      .where(and(
        eq(usage.organizationId, row.organizationId),
        eq(usage.periodId, row.periodId),
        eq(usage.costClass, row.costClass),
        isNull(usage.deleted),
        guard,
      ))
      .returning({ unitsUsed: usage.unitsUsed });
    return updated ? updated.unitsUsed : null;
  }, client);
}
```

**`apps/api/src/services/usage.service.ts`** — add:

```ts
export interface ChargeResult {
  allowed: boolean;
  used: number;       // post-charge (or current, if denied)
  available: number | null; // null = unlimited
}

/** Charge `units` of `costClass` against the org's period allocation. */
static async tryCharge(
  organizationId: string, costClass: CostHint, units: number,
  allocation: number | null, periodId: string, actor: { userId: string }, client?: DbClient
): Promise<ChargeResult> {
  const row = new UsageModelFactory().create(actor.userId)
    .update({ organizationId, periodId, costClass, unitsUsed: units }).parse();
  const newUsed = await DbService.repository.usage.chargeConditional(row, allocation, client);
  if (newUsed !== null) {
    return { allowed: true, used: newUsed, available: allocation === null ? null : allocation - newUsed };
  }
  // denied — report current
  const rows = await DbService.repository.usage.findForPeriod(organizationId, periodId, client);
  const used = rows.find((r) => r.costClass === costClass)?.unitsUsed ?? 0;
  return { allowed: false, used, available: allocation === null ? null : Math.max(0, allocation - used) };
}
```

### Redis rate-limit util

**`apps/api/src/utils/rate-limit.util.ts`** (new) — fixed-window per-minute counter:

```ts
/** Increment the current-minute counter for `key` and return the new count.
 *  Window is the wall-clock minute; TTL 120s covers the boundary. */
export async function incrementRateWindow(key: string, now: number): Promise<number> {
  const redis = getRedisClient();
  const minuteKey = `usage:rate:${key}:${Math.floor(now / 60_000)}`;
  const count = await redis.incr(minuteKey);
  if (count === 1) await redis.expire(minuteKey, 120);
  return count;
}
```

### The cost gate

**`apps/api/src/services/cost-gate.service.ts`** (new):

```ts
export type CostBearer = "application" | "organization";

export interface CostGateContext {
  organizationId: string;
  toolName: string;
  costHint: CostHint;           // from ALL_TOOL_CAPABILITIES / custom capability
  costBearer: CostBearer;       // custom/webhook ⇒ "organization"
  input: unknown;
  actor: { userId: string };
  now?: number;
}

export type GateResult =
  | { allowed: true }
  | { allowed: false; result: { error: { code: ApiCode; message: string; retryAfter?: number } } };

/** Per-tool unit cost, application-paid tools only. Default 1 for metered/
 *  expensive; fan-out tools override with f(N) (via getMeta rowCount). */
export function resolveCallCost(toolName: string, input: unknown): number {
  const fn = COST_RESOLVERS[toolName];
  return fn ? fn(input) : 1; // default: 1 unit for a metered/expensive call
}
const COST_RESOLVERS: Record<string, (input: unknown) => number> = {
  // web_search: 1 (default). geocode (#84) will register f(N) here.
};

export class CostGateService {
  static async resolveCostGate(ctx: CostGateContext): Promise<GateResult> {
    const now = ctx.now ?? Date.now();
    // 1. free ⇒ immune to all gating (short-circuit before any resolve/charge)
    if (ctx.costHint === "free") return { allowed: true };
    // 2. who-pays: org-hosted custom tools are never charged (0 units)
    if (ctx.costBearer === "organization") return { allowed: true };
    const units = resolveCallCost(ctx.toolName, ctx.input);
    if (units <= 0) return { allowed: true };

    try {
      const policy = await TierService.resolveTier({ tier: /* org.tier */ ... });
      const periodId = TierService.periodIdFor(policy.period, new Date(now));
      const alloc = policy.allocations[ctx.costHint]; // metered | expensive

      // 3. rate (Redis) — cheap, first
      if (alloc.ratePerMin !== null) {
        const rate = await incrementRateWindow(`${ctx.organizationId}:${ctx.costHint}`, now);
        if (rate > alloc.ratePerMin) return deny(ApiCode.TOOL_USAGE_RATE_LIMITED, "Rate limit exceeded; retry shortly.", 60);
      }
      // 4. quota (DB atomic) — charge only if within allocation
      const charge = await UsageService.tryCharge(
        ctx.organizationId, ctx.costHint, units, alloc.unitsPerPeriod, periodId, ctx.actor
      );
      if (!charge.allowed) return deny(ApiCode.TOOL_USAGE_QUOTA_EXCEEDED,
        `Monthly ${ctx.costHint} allocation exhausted (${charge.used} used). Resets next billing period.`);
      return { allowed: true };
    } catch (err) {
      // D6 — uniform fail-open + log (a DB/Redis outage is a total outage anyway)
      logger.warn({ err, tool: ctx.toolName }, "cost gate infra error; failing open");
      return { allowed: true };
    }
  }
}
```

`resolveTier` takes the org; the wrap passes the resolved `org` (or `organizationId` + a cached org lookup). `deny(code, message, retryAfter?)` builds `{ allowed: false, result: { error: { code, message, retryAfter } } }`.

### The build-time wrap

**`apps/api/src/services/tools.service.ts`** — at the end of `buildAnalyticsTools`, before the return, decorate every entry. Track custom tool names (added in the custom-webhook loop, ~623-645) in a `Set<string>`:

```ts
// … existing assembly builds `tools: Record<string, Tool>` and
// `customToolNames: Set<string>` (names added from organization toolpacks) …

for (const [name, tool] of Object.entries(tools)) {
  const isCustom = customToolNames.has(name);
  const costHint: CostHint = isCustom
    ? (customCapabilityByName[name]?.costHint ?? "free")
    : (ALL_TOOL_CAPABILITIES[name]?.costHint ?? "free");
  const original = (tool as any).execute;
  (tool as any).execute = async (input: unknown, options: unknown) => {
    const gate = await CostGateService.resolveCostGate({
      organizationId, toolName: name, costHint,
      costBearer: isCustom ? "organization" : "application",
      input, actor: { userId },
    });
    if (!gate.allowed) return gate.result;   // delivered as a tool-result chunk
    return original(input, options);
  };
}
return tools;
```

Every tool — built-in or custom, `free` or not — is wrapped (the guard test asserts this). `free` and org-paid short-circuit inside the gate, so the wrap is unconditional but cheap for them.

### Deny result shape

The wrap returns `gate.result` — `{ error: { code, message, retryAfter? } }` — from `execute`. Per the survey, the AI SDK delivers a returned object as a `tool-result` chunk (`portal.service.ts:661`), so the model reads `error.message` and relays it; only *thrown* errors become turn-killing `error` chunks. The gate never throws for a deny.

### Advisory `costHint` for custom tools

**`apps/api/src/prompts/system.prompt.ts`** — when listing custom/org toolpack tools, annotate those with `costHint: "metered" | "expensive"` (e.g. "⚠ potentially costly — the organization pays per call"). Advisory only; the server does not gate org-paid tools (there's no Portal cost to enforce). Keep the built-in metered/expensive tools' guidance as-is (they *are* gated).

---

## TDD test plan

Run via npm scripts (`feedback_use_npm_test_scripts`).

### Unit — `CostGateService` (`apps/api/src/__tests__/services/cost-gate.service.test.ts`)

Mock `TierService.resolveTier`, `UsageService.tryCharge`, `incrementRateWindow`.

1. `free` costHint → `{ allowed: true }`, no `resolveTier`/charge/rate call.
2. `costBearer: "organization"` (custom) → `{ allowed: true }`, no charge (who-pays).
3. `resolveCallCost` returns 0 → allowed, no charge.
4. metered, within allocation → charges `units`, allowed.
5. metered, rate over `ratePerMin` → `TOOL_USAGE_RATE_LIMITED` deny result; **no** quota charge (rate checked first).
6. metered, quota would exceed → `TOOL_USAGE_QUOTA_EXCEEDED` deny result (`tryCharge.allowed === false`).
7. `expensive` is charged too (not just metered).
8. infra error (`tryCharge` throws) → fail-open `{ allowed: true }` + warn log.
9. deny result shape is `{ error: { code, message, retryAfter? } }` (never throws).
10. `resolveCallCost` default is 1; a registered fan-out resolver returns `f(N)`.

### Integration — `UsageService.tryCharge` (`…/__integration__/db/repositories/usage.repository.integration.test.ts`, extend)

11. first charge within allocation inserts + returns new used; `available` correct.
12. charge that would exceed allocation → `allowed: false`, row **unchanged**.
13. concurrent charges never overshoot the allocation (two awaited `tryCharge` at the boundary — at most one succeeds).
14. `allocation === null` (unlimited) → always charges.
15. accumulates across calls within the period (same `(org,period,class)`).

### Integration — the wrap / guard (`…/services/tools.service` + a guard test)

16. **Guard:** every entry in `buildAnalyticsTools(...)` output has a wrapped `execute` (assert against a sentinel/marker, or that each `execute` routes through the gate) — built-in **and** custom.
17. `web_search` past quota returns the `TOOL_USAGE_QUOTA_EXCEEDED` result object (not a throw); a within-budget call returns the normal search result.
18. a custom webhook tool is wrapped but **never charged** (spy on `tryCharge` — not called for `costBearer: organization`).
19. `free` system tool (`current_time`) runs even when the org's metered/expensive quota is exhausted.

### Integration — agent relay (`…/__integration__/routes` or portal service test)

20. A denied tool call surfaces as a `tool-result` chunk (not a stream `error` chunk) — the turn continues and the model can relay the message.

### Totals ≈ **20 cases** (10 unit + ~9 integration + 1 relay). No migration test (no schema change).

---

## Acceptance criteria

- [ ] Every tool call routes through `resolveCostGate`; the guard test proves no tool (built-in or custom) is un-wrapped.
- [ ] `web_search` past the org's `metered` allocation returns `TOOL_USAGE_QUOTA_EXCEEDED` as a tool result the agent relays; within budget it returns normally and the `usage` balance increments (visible in Settings, #172).
- [ ] Past the per-minute rate → `TOOL_USAGE_RATE_LIMITED`; quota not charged on a rate denial.
- [ ] `tryCharge` is atomic — concurrent charges never exceed the allocation (test 13).
- [ ] **Custom/webhook tools are never charged** (who-pays); their `costHint` shows as advisory guidance to the agent.
- [ ] `free` tools are never charged, never denied, never rate-limited — even under an exhausted quota.
- [ ] `expensive` tools charge the allocation **and** still run their `CostAcknowledgementService` handshake (unchanged).
- [ ] Redis down → rate check fails open (quota still enforced via Postgres); a `tryCharge` DB error fails open + logs.
- [ ] `npm run lint && npm run type-check` clean; api unit + integration suites green.
- [ ] Docs updated: `CUSTOM_TOOLPACK_INTEGRATION.md` (costHint advisory for org tools; built-in metered/expensive enforced), README/CLAUDE.md cost-control convention.

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| The wrap misses a tool-construction path (a tool added outside the decorate loop). | The guard test (16) iterates the actual `buildAnalyticsTools` output and asserts every entry is wrapped — a new un-wrapped path fails CI. |
| A failed tool call must not be billed. | **Superseded by #183** — the charge moved from admission to *successful completion* (`CostGateService.commitCharge`): a thrown tool call or a failed async job charges nothing, and there are no refunds. See `docs/COST_GATE_CHARGE_TIMING.spec.md`. |
| `chargeConditional` initial-INSERT path charges over allocation (no WHERE guard on INSERT). | The INSERT seeds `unitsUsed = 0` (`DO NOTHING` on conflict); the **conditional UPDATE** does the guarded `+= units`. The insert never over-charges. Test 12. |
| Fail-open hides a real over-quota during an infra blip. | Uniform fail-open is deliberate (D6) — a DB/Redis outage is a total outage; the alternative (bricking the agent) is worse. Logged for observability. |
| Custom tool's `costHint` mis-declared as `free` to dodge the *advisory* note. | No enforcement impact (custom tools charge 0 regardless); the advisory is best-effort context. Real gating is only for app-paid built-ins, whose `costHint` is code-controlled. |
| `resolveTier` per call adds latency. | It's TTL-cached in-process (#172); the gate only calls it for non-free, app-paid calls (a small fraction — `free` and custom short-circuit first). |

**Rollback:** remove the wrap loop in `buildAnalyticsTools` (tools revert to un-gated) + `git revert`. No schema change to unwind; the `usage` table (from #172) is untouched by a #169 revert.

---

## Files touched

**`apps/api`** — new: `services/cost-gate.service.ts`, `utils/rate-limit.util.ts`, `__tests__/services/cost-gate.service.test.ts`; edit: `constants/api-codes.constants.ts` (+2 codes), `db/repositories/usage.repository.ts` (`chargeConditional`), `services/usage.service.ts` (`tryCharge`), `services/tools.service.ts` (wrap + custom-name tracking), `prompts/system.prompt.ts` (advisory), plus the integration tests above.

**`packages/core`** — none required for v1 (`costHint` already on `ToolCapabilitySchema`; `resolveCallCost` is api-side).

**Docs** — `docs/CUSTOM_TOOLPACK_INTEGRATION.md`, `README`/`CLAUDE.md`.

No migration. No new dependency. No env-var change (reuses `REDIS_URL`, `TAVILY_API_KEY`).

---

## Next step

`docs/TOOL_COST_GATE.plan.md` — TDD slices matching the discovery: (1) `resolveCallCost` + the units/who-pays helper (no gate yet); (2) `UsageService.tryCharge` + `chargeConditional` + the Redis rate util (unit + integration); (3) `CostGateService.resolveCostGate` + the `buildAnalyticsTools` wrap + guard test, charging `web_search`; (4) deny-result wiring + the two `ApiCode`s + agent-relay test + uniform fail-open; (5) advisory `costHint` to the agent + docs. #84's metered GIS tools unblock after slice 3 (they register a `resolveCallCost` and inherit the gate).
