# Tier toolpack entitlements — Plan

**TDD-sequenced implementation of the #214 contract: entitlement columns on `tiers` (fail-closed defaults, permissive backfill), `TierPolicy.entitlements` through `resolveTier`, the builder filter + registration 403, the #184-sibling guard tests, and the Toolpacks-view inert affordances.**

Spec: `docs/TIER_TOOLPACK_ENTITLEMENTS.spec.md`. Discovery: `docs/TIER_TOOLPACK_ENTITLEMENTS.discovery.md`. Issue: #214 (epic #177). Builds on the shipped #172 tier surface (`resolveTier`, `tierPolicyFromRow`, seed) and #176's migration/backfill recipe; the interim seed posture is superseded later by #218.

Three slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/tier-toolpack-entitlements`** (PR base: `epic/subscription-billing`) — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale:

- **Slice 1** lands the entire data surface (columns + model + policy field + migration/backfill + seed posture) — pure-additive; nothing enforces yet, so the repo stays green while the shape freezes. `TierPolicySchema` gaining a required `entitlements` field forces every policy fixture repo-wide to be updated **here**, keeping slice 2 purely behavioral.
- **Slice 2** is the enforcement core: builder filter + registration 403 + the guard tests. Depends only on slice 1's shape.
- **Slice 3** is the visible end: Toolpacks-view affordances + the doc-sync sweep. Depends on 1 (contract reaches the web via the usage payload); independent of 2's server internals.

---

## Slice 1 — schema: columns, model, migration/backfill, seed posture

All DB + contract shape in one commit. Fail-closed defaults, permissive backfill, OQ1 seed pin. No reader changes behavior.

**Files**

- Edit: `packages/core/src/models/tier.model.ts` — `TierEntitlementsSchema` (new export), `builtinToolpacks`/`customToolpacks` on `TierSchema`, `entitlements` on `TierPolicySchema` (spec → Core model).
- Edit: `apps/api/src/db/schema/tiers.table.ts` — the two columns with fail-closed defaults (spec → Drizzle table).
- Edit: `apps/api/src/services/tier.service.ts` — `tierPolicyFromRow` maps both fields.
- Edit: `apps/api/src/services/seed.service.ts` — `standard` INSERT gains permissive values (slugs imported from the registry); convergence-classes comment; post-seed unlisted-slug `warn`.
- Edit: `apps/api/src/__tests__/__integration__/setup.ts` — harness `standard` INSERT gains the two permissive columns (per the #176 precedent).
- Edit (fixtures): every `tierRow(...)`/policy fixture the new required fields break — `tier.service.test.ts`, `tiers.repository.integration.test.ts`, `stripe-billing-schema.integration.test.ts`, `billing.router.integration.test.ts`, `stripe-webhook.integration.test.ts`, `billing.service.endpoints.test.ts`, core `tier.model.test.ts`, plus any web fixture carrying a `TierPolicy` (`SettingsUsage.test.tsx`, `SettingsBilling.test.tsx`).
- New (migration): `<ts>_add_tier_toolpack_entitlements` — two `ADD COLUMN`s + hand-added permissive backfill `UPDATE` (spec → Migration).

**Steps**

1. **Core tests (spec cases 1–3).** `TierSchema` round-trips/rejects; `TierEntitlementsSchema` shapes; `TierPolicySchema` requires `entitlements`. Run; fail.
2. **Author the model edits**; update core fixtures. Green 1–3.
3. **Tier-service tests (cases 4–5).** `tierPolicyFromRow` maps verbatim; `resolveTier` carries entitlements through the cache. Run; fail → implement the mapping; update apps/api + apps/web policy fixtures. Green — **including the full pre-existing suites** (proves the field is contract-additive).
4. **Schema/seed integration tests (cases 16–19).** Fail-closed raw-INSERT defaults; migration probe (existing rows permissive); the OQ1 pin (SQL-tightened standard survives two `seedTiers` runs while `selectable` heals); unlisted-slug `warn`. Run; fail.
5. **Author the table edits + generate the migration** (`npm run db:generate -- --name add_tier_toolpack_entitlements`), hand-add the backfill `UPDATE`, `npm run db:migrate`; author the seed changes + harness INSERT. Green 16–19.
6. Lint + type-check (rebuild core dist before apps/api type-check — `npm run build --workspace=packages/core`).

**Done when:** cases 1–5 + 16–19 pass; all pre-existing suites green monorepo-wide; the dev DB carries permissive rows; no enforcement exists anywhere.

**Risk:** the fixture sweep is the wide part — `TierPolicySchema.entitlements` being required breaks every hand-built policy object at type-check, which is exactly the drift net working; budget the slice's time there, not in the schema.

---

## Slice 2 — enforcement: builder filter, registration 403, guard tests

The behavioral core. Tools excluded by the tier never construct; unentitled registration 403s; the CI guard enumerates by construction.

**Files**

- Edit: `apps/api/src/services/tools.service.ts` — org load + `resolveTier` + allowlist/boolean filter after the station-pack split (spec → Builder enforcement); unknown-slug `warn`.
- Edit: `apps/api/src/routes/toolpacks.router.ts` — 403 check after body parse; `@openapi` 403 response.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `TOOLPACK_NOT_ENTITLED`.
- Edit tests: `apps/api/src/__tests__/services/tools.service.test.ts` (cases 6–11, guard alongside the #184 wrap guard at l.697-756), `apps/api/src/__tests__/__integration__/routes/toolpacks.router.integration.test.ts` (cases 12–15).

**Steps**

1. **Builder tests (cases 6–9).** Per-pack subtraction; custom-boolean exclusion with read-only repo assertions (non-destructive); unknown-slug ignore+`warn`; fully-filtered station → system tools only, no throw. `TierService.resolveTier` mocked per case. Run; fail.
2. **Implement the filter** (org load → `resolveTier(org ?? { tier: "" })` → intersect/gate, per the spec's insertion point). Green 6–9 — and the untouched pre-existing tools.service suite stays green (permissive mock default).
3. **Guard tests (cases 10–11).** Restrictive tier → `Object.keys(tools)` ⊆ system tools; permissive tier → byte-identical to the pre-#214 full set. Green (no further impl — the filter from step 2 is what they pin).
4. **Route integration tests (cases 12–15).** 403 + nothing persisted; PATCH/DELETE still open on existing packs (OQ3); entitled 201 regression; the downgrade→403→upgrade→201 round-trip via SQL tier flip + `TierService.invalidate`. Run; fail → **implement the route check + code + `@openapi`**. Green.
5. Lint + type-check.

**Done when:** cases 6–15 pass; a station configured with every pack builds only system tools under an empty-allowlist tier; register 403s and recovers on upgrade with zero row changes.

**Risk:** the guard's "byte-identical full set" comparison — capture the pre-#214 key set from the existing suite's expectations, not from a snapshot taken after the filter lands (a filter bug would bake into the baseline).

---

## Slice 3 — web: inert affordances + doc-sync

The visible end: plan-state honesty in the Toolpacks view, and the documentation sweep.

**Files**

- Edit: `apps/web/src/views/Toolpacks.view.tsx` — "Inactive on your plan" `Chip` on custom-pack rows + disabled Register with tooltip, derived from `sdk.organizations.usage()`'s `tier.entitlements` (spec → Web).
- Edit tests: `apps/web/src/__tests__/Toolpacks*.test.tsx` (cases 20–22).
- Doc-sync (see cross-slice notes): `apps/web/src/utils/faq.util.ts` (+ pinning test), `docs/CUSTOM_TOOLPACK_INTEGRATION.md`.

**Steps**

1. **View tests (cases 20–22).** Unentitled → chip + disabled Register + tooltip; entitled → regression-clean; state derived from the mocked usage payload's `entitlements`. Run; fail.
2. **Implement the view changes.** Green.
3. **Doc-sync.** FAQ: extend the "managed plan" / "who can manage billing" cluster with one custom-toolpacks-entitlement Q&A (pinning test updated); `CUSTOM_TOOLPACK_INTEGRATION.md` gains the entitlement precondition + the 403 code in its error table. Verify no tool `description`/`system.prompt.ts` surface changes (availability is invisible to the agent — absent tools need no prose).
4. Lint + type-check; full `npm run test` at root.

**Done when:** cases 20–22 pass; the view renders both states against mocked payloads; the custom-toolpack author doc names `TOOLPACK_NOT_ENTITLED`.

**Risk:** none structural — MUI plumbing per the billing tab's owner-gate precedent.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Columns + model + policy field + migration/backfill + seed posture + fixture sweep | cases 1–5, 16–19 + all pre-existing suites |
| 2 | Builder filter + `TOOLPACK_NOT_ENTITLED` + guard tests | cases 6–15 |
| 3 | Toolpacks-view affordances + doc-sync | cases 20–22 |

## Cross-slice notes

- **One migration, slice 1** — additive columns + one backfill; later slices add readers, not shape. Net schema identical to the spec's Migration section.
- **Core dist rebuilds**: apps/api and apps/web resolve `@portalai/core` from `dist/` — rebuild after the slice-1 model edit before downstream type-checks (this branch's #176 lesson).
- **`TierService.invalidate`** is the immediate-effect lever for the slice-2 integration round-trip test and for ops; the 60s TTL is the accepted staleness window everywhere else.
- **Doc-sync inventory check (CLAUDE.md)**: FAQ + `CUSTOM_TOOLPACK_INTEGRATION.md` (slice 3); `@openapi` on the register route (slice 2). No `.tool.ts` descriptions, no `system.prompt.ts` (absent tools need no agent prose), no README/env changes, glossary optional (entitlements surface via existing "Subscription Plan" entry — extend its definition in slice 3 only if wording warrants).
- **Smoke prerequisites** (for `/smoke 214` after implementation): the dev DB's scratch tiers (`pro-smoke`, `enterprise-smoke`) are ready-made permissive/restrictive fixtures once slice 1's backfill runs; tightening is a two-column `UPDATE`.

## Next step

Implementation starts on this branch — slice 1, tests-first, one commit per slice — once you've confirmed discovery, spec, and this plan.
