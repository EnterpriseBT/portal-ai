# Subscription tier policy — Plan

**TDD-sequenced implementation of the tier-policy cut: `tiers` table + `TierPolicy` + `resolveTier`, the `organizations.tier` slug FK, the per-org `usage` balance + `UsageService` + read endpoint, and the Settings → Organization display.**

Spec: `docs/SUBSCRIPTION_TIER_POLICY.spec.md`. Discovery: `docs/SUBSCRIPTION_TIER_POLICY.discovery.md`. Issue: #172 (epic #177).

Four slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on the existing branch `feat/subscription-tier-policy` / PR #175** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR"), not four PRs.

Run tests from each package (never invoke jest directly — `NODE_OPTIONS` sets ESM, per `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests for the slice's behaviour; (2) implement the smallest change to green them; (3) run focused tests; (4) `npm run lint && npm run type-check` at the slice boundary; (5) next slice.

Sequencing rationale:

- **Slice 1** stands up the tier definitions end-to-end (table + models + repo + service + seed) with **no dependency on the org column** — `resolveTier` is exercised directly against seeded rows. The rest of the repo is untouched, so it type-checks throughout.
- **Slice 2** adds the `organizations.tier` slug FK. It depends on slice 1 (the `standard` row must exist for the FK-defaulted column and the backfill). `tier` auto-flows onto `OrganizationGetResponse`.
- **Slice 3** adds the `usage` table + `UsageService` (the increment seam #169 calls + `getBalance`) and the `GET /api/organization/usage` endpoint. Depends on 1 (resolveTier) and 2 (org.tier).
- **Slice 4** is the visible end: the Settings → Organization display, fed by the slice-3 endpoint.

The spec describes the net schema as one migration; the plan **splits it into three slice-aligned migrations** (create-tiers, add-org-tier, create-usage) so each slice ships green and independently. Net schema is identical.

**#169 unblocks after slices 1–3** freeze the `resolveTier` + `UsageService.increment`/`getBalance` contracts.

---

## Slice 1 — `tiers` table + `Tier`/`TierPolicy` models + repo + `TierService` + seed

The foundation. Pure-additive: new core models, a new table, a new repo, a new service, a seed. Nothing existing changes, so the whole repo keeps compiling.

**Files**

- New: `packages/core/src/models/tier.model.ts` (`TierSchema`, `TierPolicySchema`, `TierModel`, `TierModelFactory`, `TierPeriodSchema`, `OverageSchema`, `AllocationSchema`).
- New: `packages/core/src/contracts/tier.contract.ts` (the `TierPolicy`-carrying payloads; the usage-read payload is added in slice 3).
- New: `apps/api/src/db/schema/tiers.table.ts`.
- New: `apps/api/src/db/repositories/tiers.repository.ts` (`TiersRepository`, `findBySlug`, `tiersRepo`).
- New: `apps/api/src/services/tier.service.ts` (`resolveTier`, `tierPolicyFromRow`, `periodIdFor`, `invalidate`, injected clock).
- New (migration): `<ts>_create_tiers` — `CREATE TABLE tiers` + the `standard` row INSERT.
- New tests: `packages/core/src/__tests__/models/tier.model.test.ts`; `apps/api/src/__tests__/__integration__/db/repositories/tiers.repository.integration.test.ts`; `apps/api/src/__tests__/services/tier.service.test.ts`; `apps/api/src/__tests__/__integration__/db/migrations/create_tiers.test.ts`.
- Edit: `packages/core/src/models/index.ts`, `packages/core/src/contracts/index.ts` (exports); `apps/api/src/db/schema/index.ts`, `zod.ts` (`TierSelect/Insert`), `type-checks.ts` (`Tier` assertions); `apps/api/src/db/repositories/index.ts`, `services/db.service.ts` (register `tiers`); `apps/api/src/services/seed.service.ts` (`seedTiers`); `apps/api/src/constants/api-codes.constants.ts` (`TIER_DEFAULT_MISSING`).

**Steps**

1. **Core model tests (spec cases 1–5).** `TierPolicySchema` parse/reject; `AllocationSchema` null=unlimited + non-negative; `TierPeriodSchema` anchorDay bounds; `OverageSchema` enum; `TierSchema` round-trips through the factory with audit fields. Run; fail.
2. **Author `tier.model.ts`** per spec (both the flat `TierSchema` row shape and the nested `TierPolicySchema`). Green cases 1–5.
3. **`tiers` repo integration tests (spec cases 9–11).** insert + `findBySlug` round-trip (soft-deleted excluded from finder); **full `slug` UNIQUE rejects a duplicate even after soft-delete** (case 10 — proves it's a valid FK target); the CHECK constraints reject violating inserts. Run; fail (no table).
4. **Author `tiers.table.ts`** — hybrid row, **full `unique("tiers_slug_unique")` constraint** on slug (not a soft-delete-partial index — it's the FK target), CHECKs. Add `TierSelect/Insert` to `zod.ts`, the three `IsAssignable` blocks to `type-checks.ts`.
5. **Generate + hand-edit the migration.** `npm run db:generate -- --name create_tiers`. The generated SQL has `CREATE TABLE tiers`. Hand-add the `standard` row `INSERT ... ON CONFLICT (slug) DO NOTHING` immediately after (values mirror `seedTiers` — see step 8; keep in sync). Apply `npm run db:migrate`. Green cases 9–11.
6. **Author `TiersRepository`** (`findBySlug` + `tiersRepo`); register on `DbService.repository`.
7. **`TierService` tests (spec cases 18–23).** `tierPolicyFromRow` assembles nested from flat (null charge → null allocation); `resolveTier` returns a known slug's policy and **caches** (spy asserts one repo fetch on the second call within TTL); unknown slug → default `standard`, warns, no throw; `TIER_DEFAULT_MISSING` only if even standard is absent; `periodIdFor` yields `"YYYY-MM"` (monthly/anchorDay=1) and the anchor-shifted case; `invalidate` forces a re-fetch. Inject a clock so tests are deterministic (no real `Date.now()`). Run; fail.
8. **Author `TierService`** + `seedTiers(tx)` in `SeedService` (idempotent skip-if-present; canonical `standard` numbers per spec *Seed*). Call `seedTiers` from `seed()`. Green cases 18–23.
9. **Migration/seed tests (spec cases 33 partial, 35).** After migrate, `tiers` has the `standard` row; `seedTiers` run twice doesn't duplicate it (relies on the UNIQUE constraint + skip check). Green.
10. **Lint + type-check.** Clean.

**Done when:** cases 1–5, 9–11, 18–23, 33(tiers), 35 pass; `tiers` exists + seeded in the dev DB; nothing outside the new files changed behaviour.

**Risk:** the migration's hand-added `standard` INSERT drifts from `seedTiers` values. Mitigation: a comment in both pointing at the other; the values are simple scalars; seed idempotency means the migration row wins and seed is a no-op.

---

## Slice 2 — `organizations.tier` slug FK + `tier` on the model

Adds the org→tier link. Depends on slice 1 (the `standard` row + the unique slug). `tier` rides `OrganizationGetResponse` with no mapper.

**Files**

- New (migration): `<ts>_add_org_tier` — insert `standard` if absent (idempotent backstop), then `ALTER TABLE organizations ADD COLUMN tier ... DEFAULT 'standard' REFERENCES tiers(slug)`.
- New test: `apps/api/src/__tests__/__integration__/db/migrations/add_org_tier.test.ts`.
- Edit: `apps/api/src/db/schema/organizations.table.ts` (+`tier` FK column); `packages/core/src/models/organization.model.ts` (+`tier: z.string()`); `zod.ts`/`type-checks.ts` (the existing `Organization` pair now covers `tier` — no new assertion, but confirm it still holds).
- Edit tests: `packages/core` org model test (add `tier` to the fixture); `apps/api` organization router integration test (case 28).

**Steps**

1. **Core test (spec case 8).** `OrganizationSchema` now includes `tier` and parses a full org. Update the existing org fixture. Run; fails.
2. **Add `tier: z.string()`** to `OrganizationSchema`. Green case 8. (This alone would break `type-check` in api until the column lands — steps 3–4 close it in the same slice.)
3. **Migration test (spec cases 16, 34).** Seed an org **before** the migration; migrate; assert that org's `tier === "standard"` (NOT NULL DEFAULT backfill) and `resolveTier` returns the `standard` policy; and that an org row pointing at a nonexistent slug is rejected by the FK. Run; fail.
4. **Add the `tier` column** to `organizations.table.ts` (`text("tier").notNull().default("standard").references(() => tiers.slug)`). Generate the migration; hand-add the idempotent `standard` INSERT **before** the `ALTER TABLE` (FK-satisfiability backstop for environments where slice-1 seed didn't run). Apply. Green cases 16, 34.
5. **Route test (spec case 28).** `GET /api/organization/current` payload includes `tier`. Green (auto-flows via the model change; no router edit needed — confirm the response validation passes).
6. **Lint + type-check.** Clean — the api side now compiles against the `tier` field.

**Done when:** cases 8, 16, 28, 34 pass; every org (pre-existing + new) has `tier = 'standard'`; the FK rejects bad slugs.

**Risk:** an environment runs the migration without slice-1's seed, and existing orgs backfill to a `standard` that doesn't exist → FK violation. Mitigation: step 4's migration inserts `standard` (idempotent) *before* the `ALTER`; the migration is self-sufficient regardless of seed order.

---

## Slice 3 — `usage` table + `UsageService` + `GET /api/organization/usage`

The accounting balance and its read surface — the increment seam #169 will call, and the "available" read the Settings tab consumes. Depends on slices 1 (resolveTier) + 2 (org.tier).

**Files**

- New: `packages/core/src/models/usage.model.ts` (`UsageSchema`, model, factory).
- New: `apps/api/src/db/schema/usage.table.ts`.
- New: `apps/api/src/db/repositories/usage.repository.ts` (`UsageRepository`, `increment` (ON CONFLICT UPSERT), `findForPeriod`, `usageRepo`).
- New: `apps/api/src/services/usage.service.ts` (`increment`, `getBalance`).
- New (migration): `<ts>_create_usage`.
- Edit: `packages/core/src/contracts/tier.contract.ts` (+`OrganizationUsageGetResponseSchema`); `packages/core/src/{models,contracts}/index.ts`; `apps/api/src/db/schema/{index,zod,type-checks}.ts` (`Usage`); `apps/api/src/db/repositories/index.ts`, `services/db.service.ts` (register `usage`); `apps/api/src/routes/organization.router.ts` (+`GET /usage` with `@openapi`); `apps/api/src/config/swagger.config.ts` (register the payload schema).
- New tests: `packages/core` usage model + contract (cases 6, 7); `apps/api` usage repo integration (12–15); usage service (24, 25); organization router integration (26, 27, 29); migration probe (33 usage).

**Steps**

1. **Core tests (spec cases 6, 7).** `UsageSchema` rejects negative `unitsUsed` + unknown `costClass`; `OrganizationUsageGetResponseSchema` accepts a full payload incl. `available: null`. Run; fail.
2. **Author `usage.model.ts` + the contract payload.** Green 6, 7.
3. **Usage repo integration tests (spec cases 12–15).** `increment` inserts then **accumulates** on the same `(org,period,class)` (not overwrite); concurrent awaited increments sum (no lost update — the ON CONFLICT path); the unique index rejects a duplicate live key; `findForPeriod` returns only that org+period, live rows. Run; fail.
4. **Author `usage.table.ts`** (+ `zod.ts`, `type-checks.ts` `Usage` block) and generate/apply the `create_usage` migration. Author `UsageRepository.increment` (the atomic `onConflictDoUpdate` seam) + `findForPeriod`; register on `DbService`. Green 12–15.
5. **Usage service tests (spec cases 24, 25).** `getBalance` computes `available = allocation − used` per class (used=0 when no row; null allocation → available null; clamp at 0); `increment` no-ops for `units <= 0`. Run; fail → author `UsageService` → green.
6. **Route tests (spec cases 26, 27, 29).** `GET /api/organization/usage` returns `{ tier, usage }` (`standard` policy, used=0 with no rows); after `UsageService.increment(org,"metered",30,period)` the endpoint reports `metered.used=30, available=970`; 401 without auth. Run; fail.
7. **Author the endpoint** in `organization.router.ts` (resolveTier → getBalance), with the `@openapi` block referencing the registered payload schema (`swagger.config.ts`). Green 26, 27, 29.
8. **Migration probe (spec case 33 usage).** After migrate, `usage` exists. Lint + type-check clean.

**Done when:** cases 6, 7, 12–15, 24, 25, 26, 27, 29, 33(usage) pass. `TierService.resolveTier` + `UsageService.increment`/`getBalance` are now the frozen seams #169 consumes.

**Risk:** the `increment` UPSERT drops the write under concurrency if the `onConflictDoUpdate` target doesn't exactly match the unique index columns. Mitigation: case 13 asserts summed totals under concurrent awaited inserts; the target list is `(organizationId, periodId, costClass)` — identical to the index.

---

## Slice 4 — Settings → Organization display

The visible end. Read-only: tier + allocation + used + available, fed by the slice-3 endpoint.

**Files**

- Edit: `apps/web/src/api/organizations.api.ts` (+`usage()` query); `apps/web/src/api/keys.ts` (+`organizations.usage`); `apps/web/src/api/sdk.ts` (surface it).
- Edit: `apps/web/src/views/Settings.view.tsx` — Organization tab `<MetadataList>` rows.
- New test: extend/attach a Settings test for the usage rows (spec cases 30–32).

**Steps**

1. **View tests (spec cases 30–32).** Mock `sdk.organizations.usage()` (via `jest.unstable_mockModule`, the project ESM pattern): renders a Subscription Tier row (`standard`); renders used/available per class with an unlimited class showing "Unlimited"; pending/error states don't crash the tab. Run; fail.
2. **Author the SDK query** (`useAuthQuery` over `/api/organization/usage`, keyed by `queryKeys.organizations.usage()`); register in `keys.ts` + `sdk.ts`.
3. **Add the `MetadataList` rows** in `Settings.view.tsx`: Subscription Tier (display label from the policy), and per-class used/available (`available === null` → "Unlimited"). The Organization tab already consumes `sdk.organizations.current()`; add the parallel `usage()` read. Green 30–32.
4. **Manual smoke.** `npm run dev`; open Settings → Organization; confirm the tier row + per-class used (0) / available (full allocation) render for a `standard` org.
5. **Lint + type-check.** Clean.

**Done when:** cases 30–32 pass; the tab shows tier + used/available in the dev app.

**Risk:** the `MetadataList` `value` field expects a string/JSX; a per-class object needs formatting. Mitigation: format to a short string per class (`"metered: 30 / 1000"`) or render a compact list — keep it a pure presentational transform in the container, per the Component File Policy.

---

## Sequence summary

| Slice | What lands | Spec cases | Test commands |
|---|---|---|---|
| 1 | `tiers` table + `Tier`/`TierPolicy` + repo + `TierService` + seed | 1–5, 9–11, 18–23, 33(tiers), 35 | `packages/core` unit; `apps/api` unit + integration |
| 2 | `organizations.tier` slug FK + `tier` on the model | 8, 16, 28, 34 | `packages/core` unit; `apps/api` integration |
| 3 | `usage` table + `UsageService` + `GET /organization/usage` | 6, 7, 12–15, 24, 25, 26, 27, 29, 33(usage) | `packages/core` unit; `apps/api` unit + integration |
| 4 | Settings → Organization display | 30–32 | `apps/web` unit |

Total: **36 spec cases** across the four slices, plus the migration probes.

Each slice is one (or a few) commit(s) on `feat/subscription-tier-policy`; PR #175 grows commit-by-commit. No separate PRs — one feature, one PR.

---

## Cross-slice notes

- **Migration split.** The spec's single `add_tiers_usage_and_org_tier` migration is realised as three slice-aligned migrations (`create_tiers`, `add_org_tier`, `create_usage`) so each slice is independently green. Net schema is identical; the ordering invariant (standard row exists before the org FK column) is preserved because `create_tiers` (slice 1) precedes `add_org_tier` (slice 2), and `add_org_tier` also inserts `standard` idempotently as a self-sufficient backstop.
- **Standard-row source of truth.** `seedTiers` (`SeedService`) holds the canonical `standard` numbers; the two migrations that INSERT it mirror those values with an `ON CONFLICT (slug) DO NOTHING` and a cross-reference comment. Editing the live numbers later is a plain SQL `UPDATE` (the reason for the DB table) — not a code change.
- **Injected clock.** `TierService.periodIdFor`/`resolveTier` cache TTL and `UsageService.getBalance` take an injected `now`/clock (mirroring the model factories' `dateFactory`), because `Date.now()`/`new Date()` are awkward in deterministic tests. No real wall-clock in unit tests.
- **Dual-schema guards.** Each slice that adds a table adds its three `IsAssignable` blocks (`Tier` in slice 1, `Usage` in slice 3); slice 2's `tier` field is covered by the existing `Organization` pair. A mismatch fails `type-check` at that slice's boundary — the enforcement, not a separate test.
- **No enforcement here.** No slice calls `UsageService.increment` from a tool path — that is #169. This ticket only *exposes* the increment seam and *reads* the balance (the Settings display + the endpoint are the concrete readers, so `getBalance` isn't speculative infra).
- **No new dependencies, no env-var changes, no infra changes** — confirm via `git diff package*.json` (empty) at the end.
- **CLAUDE.md compliance.** File suffixes (`*.model.ts`, `*.table.ts`, `*.repository.ts`, `*.service.ts`, `*.contract.ts`, `*.router.ts`), the dual-schema five-step recipe, the `Repository` base, `@openapi` on the new route + a registered `swagger.config.ts` component, and the SDK-only frontend access (`sdk.organizations.usage()`, no direct fetch) all hold. Doc-sync: if "tier"/"units" become user-facing terms, update the Help glossary/faq in slice 4 (per the standing doc-sync convention).

---

## Next step

Implement slice 1. Before writing code, re-read the spec's *Surface* skeletons for `tier.model.ts` and `tiers.table.ts` — they are faithful to the repo's `user.model.ts` / `baseColumns` / `createSelectSchema` / `IsAssignable` conventions and should be lifted, not reinvented.
