# Un-charged per-org agent-turn rate ceiling — Plan

**TDD-sequenced implementation of the turn ceiling: tier fields end-to-end, the parameterized fixed window, the pre-write POST gate, the chat/Settings/copy surfaces, and the model-doc close.**

Spec: `docs/AGENT_TURN_CEILING.spec.md`. Discovery: `docs/AGENT_TURN_CEILING.discovery.md`. Issue: #498. Builds on shipped #172/#218 (tier machinery), #169 (rate-window + fail-open precedents), #495/#499 (the model and budgets this closes).

Five slices, each behind a green suite and each leaving the repo compilable. They land as **commits on `feat/agent-turn-ceiling`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd packages/devops-cli && npm run test:unit
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run (`--testPathPattern`, touched files only); (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale:

- **Slice 1** — the tier fields are pure data plumbing every later slice reads; landing them first (with the migration) means slices 3–4 never touch schema. Inert everywhere: null columns = unlimited = status quo until `tier apply`.
- **Slice 2** — the window util is leaf logic slice 3 composes; its delegation keeps four existing consumers byte-identical.
- **Slice 3** — the service + gate: the feature's teeth, testable against 1+2 with mocks and against real Postgres for the no-row-written guarantee.
- **Slice 4** — web + copy: consumes the policy field (1) and the ApiCode (3).
- **Slice 5** — model-doc recompute + rollout prep: needs the shipped numbers, so it closes.

---

## Slice 1 — Tier fields end-to-end (`agentTurnsPerMin` / `agentTurnsPerDay`)

Model → catalog (+ values + guards) → table + migration → `tierPolicyFromRow` → devops-cli convergence. Nullable everywhere; nothing enforces yet.

**Files**

- Edit: `packages/core/src/models/tier.model.ts` — `TierSchema` + the two flat fields; `TierPolicySchema` + top-level `agentTurns` (spec §tier.model).
- Edit: `packages/core/src/registries/tier-catalog.ts` — entry schema + values (3/9, 5/13, 10/26, null/null) + one doc-comment sentence.
- Edit: `packages/core/src/__tests__/registries/tier-catalog.test.ts` — bounded-invariant extension, enterprise-null pin, per-tier value pins, `agentTurnsPerDay` ascent.
- Edit: `apps/api/src/db/schema/tiers.table.ts` — two `integer` columns + widened non-neg check; new migration `add-agent-turn-ceilings` (`npm run db:generate -- --name add-agent-turn-ceilings`).
- Edit: `apps/api/src/services/tier.service.ts` — `tierPolicyFromRow` maps `agentTurns` (+ its unit test).
- Edit: `packages/devops-cli/src/commands/tier.ts` (`CONVERGED_POLICY_FIELDS`), `tables.ts`, `__tests__/tier.test.ts` fixtures.

**Steps**

1. **Tests (spec cases 1–3, 7, 10).** Core: schema accept/reject + catalog guards + value pins + ascent. Api: `tierPolicyFromRow` mapping. Devops-cli: field-enumeration + convergence of a drifted `agentTurnsPerDay`. Run; fail (fields missing).
2. **Implement** model + catalog + table + migration + mapping + convergence lists. Green. (Type-checks enforce model↔table agreement by construction — no new assertions.)
3. Lint + type-check; `npm run test:integration -- --testPathPattern` for the migration probe half of case 9 (columns exist, nullable, existing rows null).

**Done when:** cases 1–3, 7, 10 + the migration probe pass; `TierPolicy.agentTurns` exists but has zero consumers.

**Risk:** downstream tests constructing `TierPolicy` fixtures by hand now miss a required field — fix fixtures to spread a helper, not to re-hardcode.

---

## Slice 2 — `incrementFixedWindow` + delegation

The parameterized fixed window; the minute version becomes a delegate with byte-identical keys.

**Files**

- Edit: `apps/api/src/utils/rate-limit.util.ts` — new `incrementFixedWindow(key, windowMs, ttlSeconds, now?)`; `incrementRateWindow` delegates (spec §rate-limit.util).
- Edit/extend: the util's unit test — spec case 5.

**Steps**

1. **Tests (case 5).** Bucket rolls exactly at `windowMs` (injected `now` either side of a boundary); TTL set only on first increment; delegation key string-pinned equal to the legacy format. Run; fail.
2. **Implement.** Green; existing consumers' suites untouched (`cost-gate.resolve`, `public-rate-limit` still green).
3. Lint + type-check.

**Done when:** case 5 passes and the four legacy call sites are provably unchanged (their tests + the key pin).

**Risk:** none — additive util.

---

## Slice 3 — `AgentTurnCeilingService` + `ApiCode` + the POST gate

The feature's enforcement: never-throws admission, deny-before-write, 429 + `Retry-After`.

**Files**

- New: `apps/api/src/services/agent-turn-ceiling.service.ts` + `apps/api/src/__tests__/services/agent-turn-ceiling.service.test.ts` — spec case 6 (7 sub-cases).
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `AGENT_TURN_LIMITED`.
- Edit: `apps/api/src/routes/portal.router.ts` — the gate between ownership check and `addMessage` (spec §POST gate), `@openapi` 429 response.
- New: `apps/api/src/__tests__/__integration__/routes/agent-turn-gate.integration.test.ts` — spec case 8.

**Steps**

1. **Unit tests (case 6).** Allow under limit; minute-deny (retryAfter = to minute boundary); day-deny (to UTC midnight); null limits → zero Redis calls (spy); window-util throw → allow + warn; resolveTier throw → allow + warn; denial warn fields. Mock TierService + the window util. Run; fail.
2. **Implement the service** per the spec contract (keys, windows/TTLs, increment-then-compare, minute before day, never throws). Green.
3. **Integration test (case 8).** Seed an org on a tier row with `agent_turns_per_min = 1`: first POST 200 + user row exists; second POST within the minute → 429 `AGENT_TURN_LIMITED`, `Retry-After` set, **no second user row** (query `portal_messages`). Run; fail.
4. **Wire the gate + ApiCode + `@openapi`.** Green.
5. Lint + type-check.

**Done when:** cases 6 + 8 pass; a denied send provably writes nothing; all pre-existing portal-router tests green.

**Risk:** the SSE route must stay untouched — a reviewer diff-check, not a test; the integration case's second-POST assertion is the guard against accidentally gating after the write.

---

## Slice 4 — Web notice + TierCard row + copy pins

The user-facing half: unswallow the send error, render the notice, show the ceiling in Settings, document it.

**Files**

- New: `apps/web/src/components/TurnLimitNotice.component.tsx` (+ `__tests__` per the dialog/component checklist that applies: render, props, upgrade-link branch) — spec case 11.
- Edit: `apps/web/src/components/PortalSession.component.tsx` — the `catch` at `:424-429` per spec (notice on `AGENT_TURN_LIMITED`, existing behavior otherwise, clears on next success) + test — case 12.
- Edit: `apps/web/src/components/TierCard.component.tsx` + the tier-format util — "Agent turns" row + `formatAgentTurns` — case 13.
- Edit: `packages/core/src/content/faq.util.ts` + `glossary.util.ts` + their pinning tests — case 4.

**Steps**

1. **Tests (cases 11–13, 4).** Notice UI props/branches; PortalSession both catch branches (mocked sdk rejection with/without the code); `formatAgentTurns` shapes + TierCard row; FAQ/glossary pins. Run; fail.
2. **Implement** the component (pure UI, per the component-file policy), the catch rewiring, the row + formatter, the copy. Green.
3. Lint + type-check.

**Done when:** cases 4, 11–13 pass; a simulated 429 renders the notice with the upgrade link and an enabled composer.

**Risk:** the unswallowed catch must not regress the optimistic-message removal — case 12 asserts it in both branches.

---

## Slice 5 — Model-doc close + rollout prep

Recompute the thresholds the ceiling exists to satisfy; stage the rollout.

**Files**

- Edit: `docs/TIER_PRICING_MODEL.md` — §5 bounded-LLM recompute (T3 standard ≈ $25.7 vs $25 stated honestly; T2 plus ≈ $56.7 ≤ $58, pro ≈ $197.4 ≤ $198 → **pass**), §6 verdict `implemented (#498)`.
- No code. (Rollout itself is post-merge: `tier apply --env app-dev` then prod; `/smoke 498` scaffolds the gate walkthrough; the SSE-reconnect bug files at close-out.)

**Steps**

1. **Check (no unit suite — doc slice):** the §5 numbers recompute from the shipped catalog values; `npm run lint:doc-pointers` (the catalog comment's model-doc cite).
2. Commit.

**Done when:** the model doc's T2/T3 rows read pass with the shipped numbers; every §6 structural verdict is terminal (implemented/rejected).

**Risk:** none — arithmetic + prose.

---

## Sequence summary

| Slice | Lands | Spec cases | Suites |
|---|---|---|---|
| 1 | tier fields end-to-end + migration + convergence | 1–3, 7, 9(probe), 10 | core, api unit+integration, devops-cli |
| 2 | `incrementFixedWindow` + delegation | 5 | api unit |
| 3 | service + `AGENT_TURN_LIMITED` + POST gate | 6, 8 | api unit + integration |
| 4 | notice + TierCard row + FAQ/glossary | 4, 11–13 | web, core |
| 5 | model-doc T2/T3 close | — | doc-pointer lint |

Total ≈ **24 cases**, one nullable migration. Draft PR opens after the docs commits; grows per slice.

## Cross-slice notes

- **Inert until `tier apply`:** columns land null (unlimited); local/CI/deployed behavior is byte-identical through slice 3's merge. Activation is a per-env operator act — same rollout shape as #495/#500.
- **Rollout order (post-merge):** migrate + deploy (app-dev auto; prod at next release) → `tier apply --env app-dev` → smoke the gate live (a 1/min test tier or temporary catalog value) → `tier apply --env prod --yes --confirm-prod`. The smoke doc (`/smoke 498`) owns the walkthrough; the forced denial is local/app-dev only.
- **Close-out filings:** the SSE reconnect re-fire bug (`portal-events.router.ts:118`) — its own ticket with the #498 evidence; noted in the spec's acceptance criteria.
- **Doc-sync inventory:** FAQ + glossary in slice 4 (pinned); TierCard is data-driven; public site-config untouched by design (its strict contract test is the guard); no CLAUDE.md convention change.
- **Fixture discipline:** any test building a `TierPolicy` by hand gains `agentTurns` — prefer spreading from `tierPolicyFromRow`/a factory over re-hardcoding (slice 1 risk note).
- **T3's honest ≈$25.7:** the recompute lands a hair over the $25 trigger budget at 9/day; the model doc states it rather than rounding down — if the operator wants strict-under, standard drops to 8/day (one catalog number).

## Next step

Implementation starts at slice 1 on this branch, tests-first, one commit per slice — discovery and spec are committed; this plan is the last artifact awaiting confirmation.
