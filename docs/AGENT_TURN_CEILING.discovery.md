# Un-charged per-org agent-turn rate ceiling — Discovery

**Issue:** [EnterpriseBT/portal-ai#498](https://github.com/EnterpriseBT/portal-ai/issues/498)

**Why this exists.** The agent conversation loop is the one unbounded per-org cost surface left: tool calls are gated (#169) and re-united (#499), but nothing limits how many Sonnet turns an org can drive — `stopWhen: stepCountIs(10)` bounds steps *per turn* only. The #495 cost model priced this exposure (~$0.035/turn expected, ~$0.08 heavy) and its confirmed T3 threshold **mandates** this ticket: a heavy free org models at ≈$53/mo against a $25 budget, and T2's ceiling check can't close while turns are unbounded (post-#499, the tool term is bounded; the LLM term is not). This is the safety ceiling that bounds turns per org as a **rate** — never a charge, never a mid-turn cutoff — sized from the model's monthly-equivalent budgets (≈260/400/790 turns for standard/plus/pro; enterprise unlimited).

## The current shape

### The turn is a two-request dance (and only one leg is safe to gate)

| Piece | Location | Note |
|---|---|---|
| Send | `POST /api/portals/:id/messages` (`apps/api/src/routes/portal.router.ts:703`) — org resolved (`:709,717`), then `addMessage(role:"user")` (`:725`), returns `{status:"streaming"}` | **No model call here** |
| Stream | `GET /api/sse/portals/:portalId/stream` (`portal-events.router.ts:76`, `sseAuth` `:78`) → `PortalService.streamResponse` (`:109`) → one `streamText` (`portal.service.ts:697`) → one assistant row (`:779`) | **EventSource auto-reconnect can re-fire the model call** (warning at `portal-events.router.ts:118`) |
| Error surfaces | pre-headers: Express JSON error; mid-stream: `stream_error` frame (`portal-events.router.ts:137`) | SSE event shapes documented `:33-42` |
| Web consumption | `apps/web/src/utils/portal-stream.util.ts` (SSE hook; `stream_error` → `:234`); send errors via `sendMessage.mutateAsync` (`PortalSession.component.tsx:424`); error banner `:128` | A POST denial rides the mutation-error path |

**One send = one turn**: user row at POST, one `streamText`, one assistant row; no regenerate UI exists. Gating the POST counts turns exactly once; gating the SSE would need reconnect-dedup.

### Primitives and plumbing to reuse

| Piece | Location | Note |
|---|---|---|
| Rate window | `rate-limit.util.ts:45` `incrementRateWindow(key, now)` — **fixed per-minute** (`Math.floor(now/60_000)` in key, `:50`; TTL 120s `:27`); fail-open consumers (`:38-40`) | Day/hour windows need a `windowMs` parameterization |
| Rate precedents | cost-gate (`cost-gate.service.ts:168`), public per-IP (`public-rate-limit.middleware.ts:31`), two portal routers | All fail-open on Redis loss |
| New tier field end-to-end | `tier.model.ts:107-112` (flat triples) + `TierPolicySchema` (`:84`); catalog schema `tier-catalog.ts:23` + four entries (`:98,:120,:152,:176`); `tiers.table.ts:35-40` (+checks `:93-113`); `type-checks.ts:148-157`; `tier.service.ts:39-47` (`tierPolicyFromRow`); `tier apply` `CONVERGED_POLICY_FIELDS` (`devops-cli/src/commands/tier.ts:67-72`) + `tables.ts:40`; seed spreads catalog (`seed.service.ts:399`); migration series at `apps/api/drizzle/` (latest `0089`) | The #172/#218 machinery makes the field data, not code |
| Display | `TierCard.component.tsx:98-105` (allocation rows — a fourth "Agent turns" row fits); `site-config.contract.ts:37` is a strictObject that **deliberately withholds** policy internals | Public marketing snapshot stays untouched |
| Copy | `faq.util.ts:72,:230,:247`, `glossary.util.ts:418-420` — no turn-limit copy exists yet | New FAQ entry + glossary touch (docs-sync) |

## The design space

### Decision 1 — Where the gate sits

- **A. The POST, after org resolution and before `addMessage`.** Denial writes nothing (no user row, no stream), costs nothing, and can never land mid-turn by construction. Surfaces through the existing mutation-error path.
- **B. The SSE route, before `streamResponse`.** Closer to the model call, but the user row already exists (a "sent" message that never answers), and auto-reconnect makes counting and deny-UX messy.
- **C. Inside a `streamText` wrapper.** Deepest, but same reconnect problem plus a half-open stream on deny.

| | A POST | B SSE | C wrapper |
|---|---|---|---|
| Never mid-turn | by construction | needs care | needs care |
| Counts once per turn | yes | reconnect-dedup needed | reconnect-dedup needed |
| Deny UX | clean mutation error | orphaned user message | orphaned + stream frame |

**Lean: A.** The two-request shape hands us a natural admission point; everything else fights the reconnect semantics.

### Decision 2 — Window shape and semantics

The model's budgets are monthly-equivalent (~9/13/26 per day). Options: a single daily quota; a single per-minute burst; or the **dual bound** the class grid already uses (`…UnitsPerPeriod` + `…RatePerMin`).

- **A. Daily only** — bounds the month, but a scripted loop burns a whole day's budget in seconds and then locks the org out all day.
- **B. Per-minute only** — stops loops, but bounds the month only loosely (3/min ⇒ 129K/mo theoretical).
- **C. Dual: `agentTurnsPerDay` + `agentTurnsPerMin`** (null = unlimited) — the day bound carries the exposure math; the minute bound makes abuse fail fast instead of exhausting the day. Mirrors the existing quota+rate duality, so the plumbing, display, and operator mental model are familiar.

**Lean: C.** Same shape as everything else in the tier row. **Window anchor:** fixed UTC-day and wall-clock-minute windows — a *conscious technical window*, not billing-period semantics: this is an abuse/exposure ceiling, not an entitlement ledger, and a month-anchored quota would mean month-long lockouts (exactly what the ticket forbids: "resets when the window rolls").

### Decision 3 — State and failure posture

- **A. Redis fixed windows** (a `windowMs`-parameterized sibling of `incrementRateWindow`), fail-open on Redis loss — identical to every existing rate check.
- **B. Durable Postgres counter** (a `usage`-like row per day) — survives Redis loss, but turns are un-charged, so putting them in billing-shaped storage muddles semantics for no chargeback need.

**Lean: A — with the downgrade stated:** a Redis outage temporarily un-bounds turns (status quo ante), accepted because the ceiling is a safety bound on an un-charged surface, the split-fail precedent already makes rate checks fail-open, and the vendor account caps remain the last backstop. Denials and window increments log structured (module `agent-turn-ceiling`) — the observability story, since there is deliberately no ledger row.

### Decision 4 — The denial surface

- Server: new `ApiCode.AGENT_TURN_LIMITED`, HTTP 429 from the POST, payload carrying `retryAfterSeconds` and which window tripped (minute vs day).
- Web: the portal session renders a **friendly inline notice** on the send-mutation error — copy names the window and reset ("You've reached your plan's agent-turn limit for today — it resets at midnight UTC"), keeps the composer usable, and carries an upgrade link (`UpgradeLink` precedent) on non-pro tiers. Not a toast (the user is *in* the surface that denied them), not the generic error banner.
- Settings: `TierCard` gains an "Agent turns" row (`N/min · N/day`, null → "Unlimited"). **Public `site-config` unchanged** — the strict contract deliberately withholds policy internals, and an un-marketed safety bound stays internal.

**Lean: as above** — typed 429 + inline session notice + TierCard row; no public exposure.

## Tradeoff comparison

| | D1: gate the POST | D2: dual UTC windows | D3: Redis fail-open | D4: 429 + inline notice |
|---|---|---|---|---|
| Spread to spec | Yes | Yes (field names, windows) | Yes (util signature, log fields) | Yes (ApiCode, copy, components) |

## Recommendation

1. Gate at `POST /api/portals/:id/messages` after org resolution, before `addMessage`: resolve `TierService.resolveTier(org)`, check minute then day window, deny with `ApiError(429, AGENT_TURN_LIMITED)` carrying `retryAfterSeconds` — nothing written, nothing charged, never mid-turn.
2. Two new tier fields through the full #172/#218 machinery (model, catalog + entry values, table + checks, zod/type-checks, migration, `tierPolicyFromRow`, `CONVERGED_POLICY_FIELDS`, tables.ts, seed-by-spread): `agentTurnsPerMin`, `agentTurnsPerDay`, both nullable (null = unlimited; enterprise + org-scoped custom tiers default null).
3. Parameterize the rate window (`incrementRateWindow(key, now, windowMs?, ttlSeconds?)` or a sibling `incrementDailyWindow`) keeping the existing consumers byte-identical; per-org keys `agent-turns:${orgId}:{min|day}`.
4. Catalog numbers from the confirmed model budgets, operator-confirmed at the spec gate like #495's thresholds: **standard 3/min · 9/day; plus 5/min · 13/day; pro 10/min · 26/day; enterprise null** (monthly-equivalents 270/390/780 ≈ the 260/400/790 budgets; recompute T2/T3 in `TIER_PRICING_MODEL.md` — both flip to pass).
5. Web: inline denial notice in `PortalSession` (copy + upgrade link), "Agent turns" row in `TierCard`; FAQ + glossary entries for the new limit (docs-sync in the same PR).
6. Structured logs on every denial (`{orgId, window, limit}`) — the observability record in lieu of a ledger.

## Open questions

1. **Are 9/13/26 too tight for legitimate heavy days?** They're the strict budget fit; a power user's working session can plausibly exceed 26 turns/day on pro. Lean: ship the budget-fit numbers — they're catalog data, tunable by PR + `tier apply` in minutes, and the model doc records exactly what raising them costs; the spec gate is where the operator adjusts.
2. **Does the SSE reconnect double-fire need fixing here?** `portal-events.router.ts:118` warns a reconnect re-fires the Anthropic call — an adjacent, pre-existing cost leak the POST-side gate does not cover. Lean: out of scope; file it as its own bug at close-out (it double-*spends* but the gate still bounds *sends*).
3. **Should denials be visible to the org owner anywhere beyond logs** (e.g. a Settings "denied N times this week")? Lean: no for this ticket — logs suffice until someone asks; the surface is additive later.
4. **Migration backfill?** Lean: columns land nullable (= unlimited = status quo) and every env converges via `tier apply` — no data migration beyond the schema, matching how #495's numbers rolled out.

## Enterprise-scale considerations

- **Concurrency & correctness** — Lean: Redis `INCR` on fixed-window keys is atomic across ECS tasks; no check-then-act gap (increment-then-compare, the cost-gate pattern). Deny-after-increment slightly overcounts denied attempts against the window — acceptable for an abuse bound (they *were* attempts).
- **Accuracy & auditability** — Lean: no durable ledger, consciously — turns are un-charged, so there is no chargeback/dispute need; structured denial logs are the record. Stated downgrade, per Decision 3.
- **Failure modes** — Lean: fail-open on Redis loss (un-bounds temporarily = status quo ante; vendor caps backstop). Cost implication stated and accepted; consistent with the split-fail rule (money checks stay in Postgres — there is no money here).
- **Scale & unbounded growth** — Lean: this ticket *is* the closing of the last unbounded per-org dimension; the windows themselves are two keys/org with ≤ 26-hour TTLs — no growth surface.
- **Multi-tenancy** — Lean: per-org keys isolate tenants; a noisy org exhausts only its own windows.
- **Contract stability** — Lean: fields are nullable additions to the existing tier row/catalog/policy — tiers, custom org rows (#241), and future entitlements plug in with zero re-plumbing; public site-config untouched by design.
- **Data lifecycle** — Lean: UTC-day/minute windows are a **conscious technical window** (abuse ceiling), not billing semantics — recorded rationale in Decision 2; the billing-period-aligned quota was explicitly rejected as a month-long-lockout hazard.

## What this doesn't decide

- Metering/charging turns — permanently rejected (#495 discovery D1; the capability-tiering monetization rule).
- The SSE reconnect double-fire (open question 2) — separate bug, filed at close-out.
- Per-seat pricing (#198) — the durable fix for LLM cost scaling with users.
- Any change to `stepCountIs(10)` or per-turn step semantics.

## Next step

`docs/AGENT_TURN_CEILING.spec.md` pins the two field names end-to-end (model→catalog→table→policy→apply), the window util signature, the `AGENT_TURN_LIMITED` deny payload, the denial copy, and the catalog numbers (operator-confirmed at that gate); `docs/AGENT_TURN_CEILING.plan.md` slices roughly: (1) tier fields end-to-end + migration + catalog guard tests, (2) window util parameterization, (3) the POST gate + ApiCode + deny tests, (4) web notice + TierCard row + FAQ/glossary copy, (5) model-doc recompute (T2/T3 → pass) + rollout (`tier apply` app-dev/prod) + smoke.
