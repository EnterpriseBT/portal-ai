# Tier toolpack entitlements — Spec

**Issue:** [EnterpriseBT/portal-ai#214](https://github.com/EnterpriseBT/portal-ai/issues/214) · **Epic:** #177 · **Discovery:** `docs/TIER_TOOLPACK_ENTITLEMENTS.discovery.md` · **Branch:** `feat/tier-toolpack-entitlements` → `epic/subscription-billing`

Give tier rows an **availability axis**: a built-in toolpack allowlist + a custom-toolpacks boolean on `tiers` (data-defined, editable without deploy), carried on `TierPolicy` through the existing `resolveTier` seam, and code-enforced at the two capability-creation points — the tool builder (excluded packs never reach the agent) and custom-toolpack registration (typed 403). Downgrade is a pure projection: no rows are written, attachments stay, capability reappears on upgrade.

## Key decisions (ratified from discovery)

1. **D1 — hybrid columns**: `builtin_toolpacks` JSONB `string[]` + `custom_toolpacks` boolean scalar (#172 D1b pattern). Column defaults are **fail-closed** (`'[]'` / `false`); the migration backfill sets every existing row fully permissive, so deploy day is zero-change.
2. **D2 — builder-internal resolve**: `buildAnalyticsTools` loads the org + `resolveTier` itself; every construction path is covered by construction, guarded by a #184-sibling CI test.
3. **D3 — `string[]` + intersect-at-enforcement**: allowlist entries are unvalidated strings; unknown slugs are ignored with a `warn` (data edits never coupled to deploys).
4. **D4 — derived inert state**: no stored active/inactive flag anywhere; "inactive on your plan" is a web projection of `TierPolicy.entitlements`.
5. **OQ1 (interim, → #218)**: entitlement columns are set by the migration backfill and on seed INSERT, and **excluded from `seedTiers`' update-if-changed** — operator SQL edits survive re-seeds. Pinned by a dedicated seed test.
6. **OQ2 (interim, → #218)**: a new built-in pack is invisible until tier rows list it (fail-closed); `seedTiers` finishes with a `warn` when the registry carries a slug no live tier row lists.
7. **OQ3 — register-only gating**: `POST /api/toolpacks` 403s without entitlement; PATCH/refresh, DELETE, and station attach stay open (management ≠ availability; the builder is the sole availability authority).

## Scope

### In scope

1. `tiers.builtin_toolpacks` + `tiers.custom_toolpacks` columns — dual-schema, migration + permissive backfill.
2. `TierEntitlementsSchema` + `entitlements` on `TierPolicySchema`; `tierPolicyFromRow` assembly.
3. Entitlement filtering in `ToolService.buildAnalyticsTools` (built-in allowlist ∩ registry; custom boolean). System tools never gated.
4. `403 TOOLPACK_NOT_ENTITLED` on custom-toolpack registration.
5. Guard test: a tool-construction path that bypasses the filter fails CI (sibling of #184).
6. Seed: `standard` permissive on INSERT; entitlements excluded from convergence; post-seed unlisted-slug `warn`.
7. Web: Toolpacks view "Inactive on your plan" badge + disabled Register button with tooltip, derived from the existing usage payload.

### Out of scope

- Which exclusions each tier ships with (product data); billing-tab entitlement display; admin UI; per-tool availability; tier-change audit (#172 Q6); the cross-env tier catalog + `portalai tier apply` (#218 — supersedes this ticket's interim seed posture).

## Surface

### Core model (`packages/core/src/models/tier.model.ts`)

`TierSchema` (flat row, after `selectable`) adds:

```ts
/** Built-in toolpack slugs available on this tier (#214). Explicit allowlist —
 *  absent = unavailable; intersected with the registry at build time. */
builtinToolpacks: z.array(z.string()),
/** Whether orgs on this tier may register/use custom (webhook) toolpacks. */
customToolpacks: z.boolean(),
```

New exported schema + `TierPolicySchema` addition:

```ts
export const TierEntitlementsSchema = z.object({
  builtinToolpacks: z.array(z.string()),
  customToolpacks: z.boolean(),
});
export type TierEntitlements = z.infer<typeof TierEntitlementsSchema>;

// on TierPolicySchema (additive — #176's plan-list contract anticipated this):
entitlements: TierEntitlementsSchema,
```

`TierService.tierPolicyFromRow` (`apps/api/src/services/tier.service.ts:32-54`) maps both fields verbatim. The slug-keyed 60s TTL cache is unchanged — entitlement edits take effect within one TTL (same latitude as #172's economics edits).

### Drizzle table (`apps/api/src/db/schema/tiers.table.ts`)

```ts
/** #214: explicit allowlist of built-in pack slugs. Fail-closed default —
 *  a row inserted without it grants no built-in packs. */
builtinToolpacks: jsonb("builtin_toolpacks").$type<string[]>().notNull().default([]),
/** #214: custom (webhook) toolpack entitlement. Fail-closed default. */
customToolpacks: boolean("custom_toolpacks").notNull().default(false),
```

No new constraints (JSONB shape is guarded by the dual-schema type-checks + model validation). `zod.ts` / `type-checks.ts` pick the columns up through the existing `Tier` entries.

### Builder enforcement (`apps/api/src/services/tools.service.ts`)

`buildAnalyticsTools(organizationId, stationId, userId, portalId?)` (l.388) — signature unchanged. After the station-pack split (l.408-414) and its existing "at least one pack enabled" throw, insert the entitlement resolve + filter:

```ts
// #214: tier entitlements — availability is a projection of the org's tier
// row. Org missing → resolveTier's default-tier fallback (never a throw here).
const org = await repo.organizations.findById(organizationId);
const policy = await TierService.resolveTier(org ?? { tier: "" });
const entitled = new Set(policy.entitlements.builtinToolpacks);
// (warn once per build on allowlist slugs unknown to the registry)
const enabledPacks = new Set(builtinSlugs.filter((s) => entitled.has(s)));
const entitledCustomPackIds = policy.entitlements.customToolpacks ? customPackIds : [];
```

- The per-pack `if (enabledPacks.has(…))` blocks (l.466-612) and the custom loop (l.617-668, now over `entitledCustomPackIds`) need no other change.
- **System tools are never gated** — `current_time` / `station_context` attach via `alwaysAvailable` capability before any pack block.
- **Fully-filtered station is not an error**: the existing "must have at least one pack" throw keys off station *configuration* (pre-filter); a station whose every configured pack is unentitled builds a session with system tools only. The org's plan did this, not a config mistake.
- The existing cost-gate wrap (l.690-720) is unchanged and now wraps only entitled tools.

### Registration enforcement (`apps/api/src/routes/toolpacks.router.ts`)

In the POST `/` handler (l.291-398), immediately after the `RegisterToolpackBodySchema` parse and metadata destructure:

```ts
const org = await DbService.repository.organizations.findById(organizationId);
const policy = await TierService.resolveTier(org ?? { tier: "" });
if (!policy.entitlements.customToolpacks) {
  return next(new ApiError(403, ApiCode.TOOLPACK_NOT_ENTITLED,
    "Your plan does not include custom toolpacks"));
}
```

The route's `@openapi` block gains the 403 response. PATCH/refresh, DELETE, and station attach are **not** touched (OQ3) — their tests assert they still succeed for an unentitled org.

### Error code (`apps/api/src/constants/api-codes.constants.ts`)

In the `// Toolpacks` block (l.210-223):

```ts
/** Org's tier does not include custom toolpacks (#214). 403. */
TOOLPACK_NOT_ENTITLED = "TOOLPACK_NOT_ENTITLED",
```

### Guard test (sibling of #184)

`apps/api/src/__tests__/services/tools.service.test.ts` — alongside the cost-gate wrap guard (l.697-756), same enumeration-by-construction mechanism:

- **Restrictive tier** (`entitlements: { builtinToolpacks: [], customToolpacks: false }`, all six packs + a custom pack station-enabled): `Object.keys(tools)` contains **only** system tools.
- **Permissive tier** (all registry slugs + `true`): the built set is byte-identical to today's full set.
- Per-pack subtraction: allowlist = all-but-`web_search` → exactly `web_search`'s tools are absent.

A new construction path that skips the filter surfaces as unexpected keys under the restrictive tier — CI fails by enumeration, not by static analysis.

### Web (`apps/web/src/views/Toolpacks.view.tsx`)

The view already renders custom packs in a DataTable (columns l.115-155). Additions, all derived from `sdk.organizations.usage()`'s existing `tier: TierPolicy` payload (no new endpoint):

- Custom-pack rows gain an **"Inactive on your plan"** `Chip` when `!tier.entitlements.customToolpacks`.
- The Register button renders `disabled` with tooltip `"Your plan does not include custom toolpacks"` (same disabled-affordance pattern as the billing tab's owner gate).
- Server enforcement is the 403; the UI state is honesty, not the gate.

## Migration

`cd apps/api && npm run db:generate -- --name add_tier_toolpack_entitlements`:

1. `ALTER TABLE tiers ADD COLUMN builtin_toolpacks jsonb NOT NULL DEFAULT '[]'`, `ADD COLUMN custom_toolpacks boolean NOT NULL DEFAULT false` (fail-closed defaults).
2. Hand-added backfill (the 0068 recipe): `UPDATE tiers SET builtin_toolpacks = '<all six registry slugs>'::jsonb, custom_toolpacks = true;` — **every existing row** goes fully permissive (deploy-day zero change; this includes scratch/bespoke rows, correctly, since they predate the axis).

Rollback = drop both columns; data-lossless.

## Seed

`SeedService.seedTiers` (`apps/api/src/services/seed.service.ts:320-365`):

- INSERT path: `standard` gains `builtinToolpacks: <all registry slugs>` (import the registry's slug list — single source), `customToolpacks: true`.
- Update-if-changed path: **unchanged** — it continues to converge `selectable`/`stripePriceId` only. A comment marks the two convergence classes (seed-authoritative vs operator-authoritative) and points at #218.
- After seeding: compare the registry's slugs against the union of all live rows' allowlists; `logger.warn` any slug no tier lists (OQ2 interim).
- Integration harness: the `standard` re-seed INSERT in `__integration__/setup.ts` gains the two permissive values (per the #176 precedent), and shared `tierRow(...)` fixtures gain explicit fields.

## TDD test plan

Per-package npm scripts only (`npm run test:unit` / `test:integration`).

### Layer 1 — core model (`packages/core`, `__tests__/models/tier.model.test.ts`)

1. `TierSchema` round-trips the two new fields; rejects a row missing either.
2. `TierEntitlementsSchema` accepts `{[], false}` and `{[...slugs], true}`; rejects non-string array entries.
3. `TierPolicySchema` requires `entitlements` (compile-time: `TierPolicy` consumers see the field).

### Layer 2 — tier service (`apps/api`, `__tests__/services/tier.service.test.ts`)

4. `tierPolicyFromRow` maps both columns into `policy.entitlements` verbatim.
5. `resolveTier` carries entitlements through the cache (two reads, one fetch, same object shape).

### Layer 3 — builder enforcement (`apps/api`, `__tests__/services/tools.service.test.ts`)

6. Allowlist excludes one enabled pack → exactly that pack's tools absent; others intact.
7. `customToolpacks: false` → no custom tools built; `organizationToolpacks` repo sees reads only (no writes — non-destructive).
8. Unknown allowlist slug → ignored + `warn`; entitled known slugs unaffected.
9. Fully-filtered station (packs configured, none entitled) → builds successfully with system tools only; no throw.
10. **Guard (restrictive)**: empty allowlist + `false` → `Object.keys(tools)` ⊆ system tools.
11. **Guard (permissive)**: full allowlist + `true` → tool set identical to the pre-#214 full set.

### Layer 4 — registration route (`apps/api` integration, `__integration__/routes/toolpacks.router.integration.test.ts`)

12. Org on a `customToolpacks: false` tier → POST register 403 `TOOLPACK_NOT_ENTITLED`; nothing persisted.
13. Same org: PATCH/refresh and DELETE on a pre-existing pack still succeed (OQ3).
14. Org on an entitled tier → register 201 (regression).
15. Entitled → downgrade (SQL tier flip + `TierService.invalidate`) → register 403; upgrade → 201 again — no deploy, no data loss.

### Layer 5 — schema / migration / seed (`apps/api` integration)

16. Column defaults are fail-closed: raw INSERT without the fields → `[]` / `false`.
17. Migration probe: pre-existing rows (incl. `standard`) are fully permissive post-backfill.
18. **OQ1 pin**: tighten `standard` by SQL (`builtin_toolpacks = '[]'`, `custom_toolpacks = false`), run `seedTiers` twice → entitlements survive; `selectable` still heals.
19. Post-seed unlisted-slug `warn` fires when a registry slug is missing from every row; silent when covered.

### Layer 6 — web (`apps/web`, `__tests__/Toolpacks*.test.tsx`)

20. Unentitled: custom-pack rows show the "Inactive on your plan" chip; Register disabled with tooltip.
21. Entitled: no chip; Register enabled (regression).
22. Usage-payload plumbing: the view derives state from `tier.entitlements.customToolpacks` (mock shapes match the contract).

**Totals ≈ 22 cases** (3 core, 2 tier service, 6 builder, 4 route, 4 schema/seed, 3 web).

## Acceptance criteria

- [ ] All new tests pass; existing suites green (notably: every pre-#214 tools.service test passes untouched under the permissive default); root lint + type-check clean.
- [ ] Editing an org's tier row to `custom_toolpacks = false` (SQL, no deploy): agent tool list contains no custom tools within one cache TTL; register returns 403 `TOOLPACK_NOT_ENTITLED`; reverting the row re-enables both.
- [ ] Removing a built-in slug from a tier row's allowlist removes exactly that pack's tools for orgs on that tier; other tiers unaffected.
- [ ] A downgraded org's registrations and station attachments survive untouched (DB rows byte-identical) and work again after upgrade.
- [ ] Deploy day: zero behavior change for existing orgs (backfill permissive); the harness/CI suites prove it by running the full pre-existing test set against the migrated schema.
- [ ] `seedTiers` never reverts an operator's entitlement edit (OQ1 pin test).
- [ ] A tool-construction path that bypasses the entitlement filter fails CI (guard cases 10–11).

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Backfill misses a row → org silently loses packs on deploy day (fail-closed defaults cut both ways). | Backfill is an unconditioned `UPDATE tiers SET …` (all rows); migration probe (case 17) asserts it; acceptance requires the full pre-existing suite green post-migrate. |
| Seed convergence regression re-introduces the OQ1 revert. | Case 18 pins it; the convergence-classes comment marks intent for future columns. |
| A future tool-construction path skips the filter. | Guard cases 10–11 enumerate by construction (same CI net as #184). |
| Registry/allowlist drift (new pack invisible; typo'd slug inert). | Fail-closed by design; post-seed `warn` (case 19) + release-checklist note; durable fix is #218. |
| Cache staleness: entitlement edit takes ≤ 60s to bite. | Same TTL latitude as #172 economics edits; `TierService.invalidate(slug)` for immediate effect (CLI/ops path). |

**Fail-mode statement:** enforcement is fail-closed end-to-end — no resolvable policy ⇒ no pack tools (a DB outage already fails session build); column defaults grant nothing; the only fallback (unknown org tier → `standard`) grants exactly what the operator left on the standard row.

## Files touched

**`packages/core`** — edit: `models/tier.model.ts` (+`TierEntitlementsSchema`, row fields, policy field); tests.

**`apps/api`** — edit: `db/schema/tiers.table.ts`, `services/tier.service.ts` (`tierPolicyFromRow`), `services/tools.service.ts` (builder filter), `routes/toolpacks.router.ts` (403 + `@openapi`), `constants/api-codes.constants.ts` (+1 code), `services/seed.service.ts` (INSERT values + convergence comment + unlisted-slug warn), `src/__tests__/__integration__/setup.ts` (harness INSERT); new migration; tests (unit + integration incl. the guard).

**`apps/web`** — edit: `views/Toolpacks.view.tsx` (chip + disabled Register + tooltip); tests.

## Next step

`docs/TIER_TOOLPACK_ENTITLEMENTS.plan.md` — likely 3 slices, each a green testable commit: (1) schema + model + migration/backfill + seed interim posture (inert — nothing reads the columns; cases 1–5, 16–19); (2) enforcement — builder filter + registration 403 + guard tests (cases 6–15); (3) web badge/disabled affordance + doc-sync sweep (cases 20–22; glossary/FAQ only if the walk shows user-facing copy is warranted).
