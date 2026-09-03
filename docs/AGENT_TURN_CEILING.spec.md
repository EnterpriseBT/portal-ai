# Un-charged per-org agent-turn rate ceiling — Spec

**Issue:** [EnterpriseBT/portal-ai#498](https://github.com/EnterpriseBT/portal-ai/issues/498) · **Discovery:** `docs/AGENT_TURN_CEILING.discovery.md`

Pins the contract for bounding agent turns per org: two nullable tier fields (`agentTurnsPerMin` / `agentTurnsPerDay`) through the full tier machinery, a parameterized Redis fixed-window, an admission check at the message-POST (deny **before** anything is written), the `AGENT_TURN_LIMITED` 429, and the chat/Settings/copy surfaces.

## Key decisions (flag for review)

1. **Gate the POST, pre-write.** `POST /api/portals/:id/messages` denies after the portal-ownership check and **before** `PortalService.addMessage` (`portal.router.ts:725`) — no user row, no SSE, no model call, never mid-turn, exactly one count per send. The SSE route is untouched (its auto-reconnect re-fire is a separate pre-existing leak, filed at close-out).
2. **Dual UTC windows as tier data:** `agentTurnsPerMin` (burst) + `agentTurnsPerDay` (exposure), null = unlimited. Fixed wall-clock windows are a *conscious technical window* (abuse ceiling, not billing semantics — a month-anchored quota would lock orgs out for weeks).
3. **Numbers (catalog data, ratified with the discovery):** standard **3/min · 9/day**, plus **5/min · 13/day**, pro **10/min · 26/day**, enterprise **null/null**. Monthly-equivalents 270/390/780 ≈ the model's budgets; tunable by catalog PR + `tier apply` in minutes.
4. **Fail-open, no ledger — stated downgrades:** Redis loss or tier-resolution failure ⇒ allow + structured warn (turns are un-charged; vendor caps backstop; matches the split-fail rule). No durable counter — structured denial logs (`module: agent-turn-ceiling`) are the record.
5. **Denials are never charged and never surface as generic errors:** typed 429 + `Retry-After`, rendered as a friendly inline notice in the session (composer stays usable, upgrade link on non-pro). Note: the current send path **silently swallows** errors (`PortalSession.component.tsx:424-429` bare `catch`) — this spec pins the new behavior.
6. **No public exposure:** `site-config.contract.ts` stays byte-identical (strict snapshot deliberately withholds policy internals). Settings' TierCard gains an "Agent turns" row.

## Scope

### In scope
1. `packages/core`: tier model + catalog fields/values + guard tests; FAQ/glossary copy.
2. `apps/api`: table columns + migration, `tierPolicyFromRow`, window util generalization, `AgentTurnCeilingService`, POST gate + `ApiCode`, `@openapi` update.
3. `packages/devops-cli`: `CONVERGED_POLICY_FIELDS` + tables mirror + test enumeration.
4. `apps/web`: send-error notice component + wiring, TierCard row + formatter.
5. `docs/TIER_PRICING_MODEL.md`: T2/T3 recompute (both flip to pass) + §6 verdict `implemented (#498)`.

### Out of scope
- Charging/metering turns (permanently rejected); the SSE reconnect re-fire (separate bug at close-out); per-seat pricing (#198); denial analytics surfaces beyond logs; `stepCountIs` changes.

## Surface

### `packages/core/src/models/tier.model.ts`

`TierSchema` (after `expensiveRatePerMin`, mirroring the grid's nullability):

```ts
/** #498: un-charged agent-turn ceiling — abuse/exposure bound, never billed.
 *  null = unlimited (enterprise + org-scoped custom tiers). */
agentTurnsPerMin: z.number().int().nonnegative().nullable(),
agentTurnsPerDay: z.number().int().nonnegative().nullable(),
```

`TierPolicySchema` gains a top-level field (NOT under `allocations` — turns are not a cost class):

```ts
/** #498: fixed UTC-minute/day send ceilings; null = unlimited. */
agentTurns: z.object({
  perMin: z.number().int().nonnegative().nullable(),
  perDay: z.number().int().nonnegative().nullable(),
}),
```

### `packages/core/src/registries/tier-catalog.ts`

`TierCatalogEntrySchema` += both fields (same z-shape). Entry values: standard `3`/`9`, plus `5`/`13`, pro `10`/`26`, enterprise `null`/`null`. Doc comment gains one sentence: turns are the un-charged fourth bound, sized in `docs/TIER_PRICING_MODEL.md`.

**Guard tests** (`tier-catalog.test.ts`): the #325 bounded-invariant `it.each` extends to assert `agentTurnsPerMin`/`agentTurnsPerDay` non-null on every `subscribe`/`none` tier; the enterprise-exception test asserts both null; the per-tier `toMatchObject` pins gain the exact values above; ladder ascent: `agentTurnsPerDay` strictly ascends standard < plus < pro.

### `apps/api/src/db/schema/tiers.table.ts` + migration

Two columns after `expensiveRatePerMin` (`tiers.table.ts:39-40` pattern): `agentTurnsPerMin: integer("agent_turns_per_min")`, `agentTurnsPerDay: integer("agent_turns_per_day")`; extend the non-negativity `check` with both (NULL-tolerant, matching `tiers_charges_nonneg`). Migration: `npm run db:generate -- --name add-agent-turn-ceilings` — pure `ADD COLUMN`, nullable, **no backfill** (null = unlimited = status quo; every env converges via `tier apply`). `zod.ts` select/insert schemas regenerate by construction; `type-checks.ts` needs no new assertions (the existing `Tier` pair enforces the addition).

### `apps/api/src/services/tier.service.ts`

`tierPolicyFromRow` (at `tier.service.ts:32`) maps:

```ts
agentTurns: { perMin: row.agentTurnsPerMin, perDay: row.agentTurnsPerDay },
```

### `apps/api/src/utils/rate-limit.util.ts`

Generalize without touching consumers:

```ts
/** Fixed-window counter with caller-chosen window. Key format matches the
 *  minute window's exactly (`usage:rate:${key}:${bucket}`). Throws on Redis
 *  error/timeout — callers treat as allow. */
export async function incrementFixedWindow(
  key: string,
  windowMs: number,
  ttlSeconds: number,
  now: number = Date.now()
): Promise<number>;
```

`incrementRateWindow(key, now)` becomes a one-line delegate: `incrementFixedWindow(key, 60_000, WINDOW_TTL_SECONDS, now)` — identical keys/TTL, all four existing call sites byte-identical.

### `apps/api/src/services/agent-turn-ceiling.service.ts` (new)

```ts
export type TurnAdmission =
  | { allowed: true }
  | { allowed: false; window: "minute" | "day"; limit: number; retryAfterSeconds: number };

export class AgentTurnCeilingService {
  /** Pre-turn admission (#498). NEVER throws; any infra/tier-resolution
   *  failure logs a warn and returns allowed (fail-open — un-charged safety
   *  bound; vendor caps backstop). Checks minute then day; a null limit
   *  skips its window entirely (no Redis call). */
  static async checkAdmission(
    organizationId: string,
    now?: number
  ): Promise<TurnAdmission>;
}
```

Behavior contract: keys `agent-turns:${organizationId}:min` (window 60s, TTL 120s) and `:day` (window 86_400_000ms, TTL 90_000s); `retryAfterSeconds` = seconds to the next minute boundary / next UTC midnight (from `now`); denial logs warn `{ organizationId, window, limit }` (module `agent-turn-ceiling`); increments-then-compares (denied attempts count against the window — they were attempts); a minute-window pass still increments the day window before the day check (one send = one increment in each active window).

### `apps/api` — `ApiCode` + the POST gate

- `api-codes.constants.ts`: `AGENT_TURN_LIMITED = "AGENT_TURN_LIMITED"`.
- `portal.router.ts` POST `/:id/messages`: after the portal-ownership check (`:718-723`), before `addMessage` (`:725`):

```ts
const admission = await AgentTurnCeilingService.checkAdmission(organizationId);
if (!admission.allowed) {
  res.set("Retry-After", String(admission.retryAfterSeconds));
  return next(new ApiError(429, ApiCode.AGENT_TURN_LIMITED,
    admission.window === "day"
      ? "You've reached your plan's agent-turn limit for today. It resets at midnight UTC."
      : "You're sending messages too quickly. Try again in a moment."));
}
```

- `@openapi` block on the route gains the 429 response (standard error envelope `$ref`; no new component shape).

### `packages/devops-cli`

`CONVERGED_POLICY_FIELDS` (`tier.ts:62-85`) += `"agentTurnsPerMin"`, `"agentTurnsPerDay"` (catalog-owned policy, converged); `tables.ts` field mirror += both; `tier.test.ts`'s field enumeration fixture updates. `tier create` (custom tiers) inherits its all-unlimited default — both null — with no change.

### `apps/web`

- **`components/TurnLimitNotice.component.tsx` (new, pure UI):** `TurnLimitNoticeUI` — props `{ message: string; showUpgrade: boolean }`; renders MUI `<Alert severity="warning">` with the message and, when `showUpgrade`, the existing `UpgradeLink` ("Upgrade for higher limits"). No container needed (props-only per the component-file policy).
- **`components/PortalSession.component.tsx`:** the send `catch` (`:424-429`) stops swallowing: `toServerError(err)`; if `code === "AGENT_TURN_LIMITED"`, keep removing the optimistic message but set `turnLimitNotice` state rendered above the composer (`<TurnLimitNoticeUI message={serverError.message} showUpgrade={tierIsNotPro} />`); any other code falls back to the existing generic error surface. Notice clears on the next successful send.
- **`components/TierCard.component.tsx`** (`rows` at `:97-110`): new row `{ label: "Agent turns", value: formatAgentTurns(policy.agentTurns) }` — `formatAgentTurns` in the tier-format util: `"5/min · 13/day"`, any-null side omitted, both-null → `"Unlimited"`.

### Copy (docs-sync, same PR)

- `packages/core/src/content/faq.util.ts`: new entry — "Is there a limit on how many messages I can send?" (plans include a per-minute/per-day send ceiling; tool credits are separate; upgrade raises it; resets at midnight UTC) + its pinning test.
- `glossary.util.ts:418` "Subscription Plan" definition gains a clause mentioning the send ceiling alongside usage allocations; pinning test updated.

### `docs/TIER_PRICING_MODEL.md`

§5: recompute with the ceilings — heavy-LLM term bounded at `perDay × 30 × $0.08` (standard $21.60, plus $31.20, pro $62.40); **T3 flips to pass** (standard worst ≈ $25.7 vs $25 budget — within rounding of the confirmed trigger; state the number honestly) and **T2 flips to pass** (plus ≈ $56.7 ≤ $58; pro ≈ $197.4 ≤ $198). §6 verdict → `implemented (#498)`.

## Migration / Seed

Migration `add-agent-turn-ceilings` as above (nullable columns + widened check; no data). Seed: `seedTiers` spreads the catalog entry (`seed.service.ts:399`) — flows automatically, no edit.

## TDD test plan

### `packages/core` — `npm run test:unit`
1. `TierSchema`/`TierPolicySchema` accept the new fields, reject negatives, accept nulls (`tier.model` tests).
2. Catalog guard: every `subscribe`/`none` tier bounds both turn fields; enterprise both null (`tier-catalog.test.ts` #325 block extension).
3. Per-tier value pins updated (3/9, 5/13, 10/26) + `agentTurnsPerDay` strict ascent.
4. FAQ + glossary pinning tests re-pinned to the new copy.

### `apps/api` — `npm run test:unit`
5. `incrementFixedWindow`: bucket rolls at `windowMs` boundary (injected `now`); TTL set only on first increment; `incrementRateWindow` delegates with identical key format (string-pin the key).
6. `AgentTurnCeilingService` (mocked TierService + window util): under-limit allows; minute-deny with `retryAfterSeconds` = seconds-to-minute-boundary; day-deny with seconds-to-UTC-midnight; null limits skip Redis entirely (spy: no calls); window-util throw → allow + warn; `resolveTier` throw → allow + warn; denial warn carries `{organizationId, window, limit}`.
7. `tierPolicyFromRow` maps the two columns into `agentTurns`.

### `apps/api` — `npm run test:integration`
8. POST over the minute limit → **429 `AGENT_TURN_LIMITED`**, `Retry-After` header set, and **no `portal_messages` user row written**; under the limit → 200 and the row exists.
9. Migration probe: columns exist post-migrate, nullable; existing tier rows unaffected (null).

### `packages/devops-cli` — `npm run test:unit`
10. `CONVERGED_POLICY_FIELDS` includes both (enumeration fixture); `tier apply` converges a drifted `agentTurnsPerDay` (generic convergence case extended).

### `apps/web` — `npm run test:unit`
11. `TurnLimitNoticeUI`: renders message; upgrade link only when `showUpgrade`.
12. `PortalSession`: a mocked `sendMessage` rejection with code `AGENT_TURN_LIMITED` renders the notice, removes the optimistic message, leaves the composer enabled; a different code does not render the notice.
13. `formatAgentTurns`: `"5/min · 13/day"`, one-sided, `"Unlimited"`; TierCard renders the row.

**Totals ≈ 24 cases.** Migration covered by case 9; no seed test (spread-through).

## Acceptance criteria

- [ ] A send beyond the tier's minute or day ceiling returns 429 `AGENT_TURN_LIMITED` with `Retry-After`; **nothing is persisted, streamed, or charged**; the chat shows the friendly notice with an upgrade link (non-pro) and the composer stays usable; the next allowed send works without a reload.
- [ ] Under-limit behavior is byte-identical to today; enterprise/custom tiers (null) never touch Redis for this check.
- [ ] Redis loss or tier-resolution failure allows the send and logs one structured warn — the app never blocks turns on infra.
- [ ] The ceilings are tier-row data: visible in Settings' TierCard ("Agent turns"), converged by `portalops tier apply`, absent from public `site-config` (contract unchanged).
- [ ] `docs/TIER_PRICING_MODEL.md` §5 shows T2 and T3 **pass** with the shipped numbers; §6 records `implemented (#498)`.
- [ ] FAQ + glossary describe the limit (pinning tests updated); root `lint`/`type-check`/suites green.
- [ ] The SSE reconnect re-fire is filed as its own bug at close-out.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| 9/13/26 pinch legitimate heavy users | Catalog data — a one-line PR + `tier apply` retunes in minutes; denial logs show who hits it and how often before anyone complains. |
| Fail-open un-bounds turns during a Redis outage | Stated downgrade (un-charged safety bound; status quo ante; vendor caps backstop) — consistent with the split-fail rule. |
| Double increment semantics (deny still counts) | Deliberate: denied attempts are attempts; contract documented on the service. |
| The web catch currently swallows all errors — regression risk while unswallowing | Case 12 pins both branches (notice for `AGENT_TURN_LIMITED`, existing behavior otherwise). |
| Migration on live envs | Nullable `ADD COLUMN` — instant, no lock risk at current table size; activation only via `tier apply`. |

**Rollback:** set the four tiers' turn fields to null (catalog PR + `tier apply`) — the gate short-circuits without a deploy; full revert = revert the branch + a follow-up migration to drop the columns (nullable, data-free — safe either order).

## Files touched

- **New:** `apps/api/src/services/agent-turn-ceiling.service.ts` (+ its test), `apps/api/src/__tests__/__integration__/routes/agent-turn-gate.integration.test.ts`, `apps/web/src/components/TurnLimitNotice.component.tsx` (+ test), the migration.
- **Edit:** `packages/core` — `tier.model.ts`, `tier-catalog.ts` (+ test), `faq.util.ts`, `glossary.util.ts` (+ pins); `apps/api` — `tiers.table.ts`, `tier.service.ts` (+ test), `rate-limit.util.ts` (+ test), `portal.router.ts` (+ `@openapi`), `api-codes.constants.ts`; `packages/devops-cli` — `commands/tier.ts`, `tables.ts` (+ test fixtures); `apps/web` — `PortalSession.component.tsx` (+ test), `TierCard.component.tsx`, tier-format util (+ tests); `docs/TIER_PRICING_MODEL.md`.

## Next step

`docs/AGENT_TURN_CEILING.plan.md` — five TDD slices on this branch: (1) tier fields end-to-end (model, catalog + guards, table + migration, `tierPolicyFromRow`, devops-cli convergence); (2) `incrementFixedWindow` + delegation; (3) `AgentTurnCeilingService` + `ApiCode` + the POST gate (unit + integration, cases 6/8); (4) web notice + TierCard row + copy pins; (5) model-doc recompute + rollout (`tier apply` app-dev/prod) + smoke + filing the SSE-reconnect bug.
