# Tier toolpack entitlements — Discovery

**Issue:** [EnterpriseBT/portal-ai#214](https://github.com/EnterpriseBT/portal-ai/issues/214) · **Epic:** #177 · **Branch:** `feat/tier-toolpack-entitlements` → `epic/subscription-billing`

**Why this exists.** Tiers govern **credit allocation** (#172 declares it, #169 enforces it) and, since #176, a Stripe subscription writes the org's tier slug — but the slug still buys only *numbers*. Monetization needs tier-differentiated **capability**: which toolpacks exist for an org at all. The specific exclusions per tier are deliberately undecided product data; the deliverable is the mechanism — an entitlements shape on `tiers` rows (**data-defined**, editable by SQL/CLI without deploy) that the server **code-enforces** at tool-build time and at custom-toolpack registration. This is the availability axis of the tier contract that #176 was explicitly shaped not to preclude (`project_tier_two_axes`): #172 owns *how much you can spend*, #169 *stops you spending past it*, and this ticket owns *what exists to spend on*.

## The current shape

### The tier surface (#172 + #176)

| Touch point | File | Note |
|---|---|---|
| Row schema | `packages/core/src/models/tier.model.ts:71-91` | Flat row: scalar charge grid + JSONB `perToolCaps` (l.83) + #176's `stripePriceId`/`selectable` (l.86-89). Entitlement fields join this shape. |
| Policy schema | `packages/core/src/models/tier.model.ts:53-64` | `TierPolicySchema` — the assembled consumer contract. **No availability fields today**; this is the seam #214 extends (the contract change #176 kept additive-open). |
| Drizzle table | `apps/api/src/db/schema/tiers.table.ts:23-75` | JSONB precedent `per_tool_caps` typed `$type<Record<…>>` (l.39-42). |
| Resolver | `apps/api/src/services/tier.service.ts:61-90` | `resolveTier({tier}) → TierPolicy`, slug-keyed 60s TTL cache (l.20), `tierPolicyFromRow` (l.32-54), `invalidate()` (l.121-125). Unknown slug → `standard` fallback. |
| Consumers | `cost-gate.service.ts:147`, `usage.service.ts:110`, `organization.router.ts:598-607` | Gate reads allocations; the org usage endpoint returns the whole `TierPolicy` to the web — entitlements ride to the frontend **for free**. |

### Tool construction — one choke point

`ToolService.buildAnalyticsTools` (`apps/api/src/services/tools.service.ts:388-733`) is the single path that assembles the agent's tools: `stationToolpacks.findByStationId` (l.408) → split into `builtinSlugs` / `customPackIds` (l.409-414) → per-pack `if (enabledPacks.has(…))` blocks for built-ins (l.466-612) → custom/webhook tools from `organizationToolpacks.findManyByIds` (l.617-668) → `wrapWithCostGate` (l.690-720, the #169/#183 seam). It receives only `organizationId: string` — the org row and its tier are **not** in scope today; the cost gate loads them itself per call (`cost-gate.service.ts:142-147`).

### Toolpack enablement + registration

- Built-in registry: `packages/core/src/registries/builtin-toolpacks.ts` — six slugs via `BuiltinToolpackSlugSchema` (l.32-39): `data_query, statistics, regression, financial, web_search, entity_management`; lookups `BUILTIN_TOOLPACK_BY_SLUG` / `isBuiltinToolpackSlug` (l.1201-1213). No tier/free flag exists on packs — entitlements are a new, tier-side dimension.
- Enablement tables: `station_toolpacks` (XOR of `builtinSlug`/`organizationToolpackId`, `station-toolpacks.table.ts:31-34`) picks packs per station; `organization_toolpacks` stores custom packs.
- Registration: `toolpacks.router.ts:291-398` (POST register) + `toolpack-registration.service.ts`; typed codes at `api-codes.constants.ts:210-223` — **no entitlement 403 exists yet**. Listing UI `views/Toolpacks.view.tsx` (DataTable columns l.115-155) has **no active/inactive column** — the "inert" display is net-new.

### The #184 guard-test pattern

`apps/api/src/__tests__/services/tools.service.test.ts:697-756` builds the real full tool set, spies the gate to a deny sentinel, and asserts every built tool's `execute` is intercepted — enumeration by construction, not static analysis, so a bypassing path fails CI automatically. The entitlements sibling inverts it: build under a restrictive tier and assert excluded tools **never appear in `Object.keys(tools)`**.

### Migration + seed precedent

`0068_add_stripe_billing_columns_and_events.sql:23-33` (#176) is the exact recipe: `ALTER TABLE tiers ADD COLUMN …` + hand-added backfill `UPDATE`. `SeedService.seedTiers` (`seed.service.ts:320-365`) is idempotent with update-if-changed convergence (l.325-340). Dual-schema drift fails CI via `type-checks.ts:140-153`.

## The design space

### Decision 1 — Entitlements data shape on `tiers`

- **A — one JSONB column** `entitlements: { builtinToolpacks: string[]; customToolpacks: boolean }`. Single column, single shape.
- **B — hybrid: JSONB allowlist + boolean scalar.** `builtin_toolpacks: jsonb (string[])` + `custom_toolpacks: boolean NOT NULL`. Matches #172's D1b hybrid rule: scalars for fixed-shape flags ("change a flag" = plain SQL), JSONB only for the variable-length piece.
- **C — child table** `tier_toolpacks(tier_slug, builtin_slug)`. Relational purity; a join (or second query) on the `resolveTier` hot path, a second table to migrate/seed, for a list that is bounded by the pack registry (single digits).

| | A — one JSONB | B — hybrid | C — child table |
|---|---|---|---|
| House precedent | partial | **exact (#172 D1b: `perToolCaps` + scalar grid)** | none on `tiers` |
| "Flip custom off" as SQL | JSONB surgery | **`SET custom_toolpacks = false`** | n/a (boolean still needs a home) |
| Resolver cost | 1 row read | **1 row read** | join / 2nd query |
| Dual-schema surface | 1 column | 2 columns | new table + model + repo |

**Lean: B.** The boolean is a fixed-shape operator flag — the whole point is that flipping it is a trivial `UPDATE`; the allowlist is the variable-length piece and takes the `perToolCaps`-style typed JSONB. C buys nothing at this cardinality and puts a join on a hot, cached path.

### Decision 2 — Where enforcement learns the tier

- **A — inside `buildAnalyticsTools`**: load the org + `resolveTier` at the top of the builder (mirrors the cost gate's own internal load, `cost-gate.service.ts:142-147`).
- **B — thread `TierPolicy` from the caller** (`portal.service.ts:607-629` → router): no extra load, but every present and future call site must remember to thread it — precisely the bypass the guard test exists to prevent.

**Lean: A.** The filter must hold for every construction path *by construction*, not by caller discipline. `resolveTier` is TTL-cached and the org read is one indexed `findById` per session build — noise next to the pack assembly itself.

### Decision 3 — `TierPolicy` contract shape

Add to `TierPolicySchema` (and `tierPolicyFromRow`):

```ts
entitlements: z.object({
  builtinToolpacks: z.array(z.string()),   // slugs; intersected with the registry at build
  customToolpacks: z.boolean(),
})
```

`z.string()` rather than `BuiltinToolpackSlugSchema`: rows are data and may legitimately carry a slug for a pack that ships in the *next* deploy (or was retired); validation-by-enum would turn a data edit into a deploy coupling. Unknown slugs are ignored at build time with a `warn` — same posture as `deriveTierFromSubscription`'s unmapped-price handling. **Lean: strings + intersect-at-enforcement.**

### Decision 4 — Non-destructive downgrade representation

- **A — derived, never stored**: a custom pack is "inert" ⇔ `!policy.entitlements.customToolpacks`. Zero writes on downgrade/upgrade; registrations untouched; reactivation is automatic because nothing was deactivated.
- **B — stored flag flipped on tier change**: requires a writer on every tier transition (webhook, CLI, SQL edits…) — exactly the destructive/lossy coupling the ticket forbids, and it can drift.

**Lean: A.** The tier row is the single source of truth; "inert" is a projection of it. The Toolpacks list derives an `Inactive on your plan` badge from the same `TierPolicy` the usage endpoint already ships to the web — no new endpoint, no stored state.

## Tradeoff comparison

| | D1: hybrid columns | D2: builder-internal resolve | D3: string[] + intersect | D4: derived inert |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| New table/endpoint | No | No | No | No |
| Writes on tier change | — | — | — | **None** |

## Recommendation

1. `tiers` gains `builtin_toolpacks` (JSONB `string[]`, typed like `perToolCaps`) and `custom_toolpacks` (boolean, NOT NULL) — dual-schema, one migration with a hand-added backfill `UPDATE` setting every existing row fully permissive (all six registry slugs + `true`), per the 0068 recipe.
2. `TierPolicySchema` gains `entitlements: { builtinToolpacks: string[]; customToolpacks: boolean }`, assembled in `tierPolicyFromRow`; it flows to the web via the existing `/api/organization/usage` response unchanged.
3. `ToolService.buildAnalyticsTools` loads the org + `resolveTier` at the top and (a) intersects station-enabled built-in slugs with the entitlement allowlist ∩ registry before the per-pack blocks, (b) skips the custom-pack loop entirely when `customToolpacks` is false. System tools (`current_time`, `station_context`) are pack-less and never gated.
4. `POST /api/toolpacks` returns `403 TOOLPACK_NOT_ENTITLED` (new code) when the org's policy has `customToolpacks: false` — checked right after body parse; refresh/PATCH/DELETE of existing registrations stay allowed (management ≠ availability).
5. Downgrade is a pure projection: no schema or writes on `organization_toolpacks`; the Toolpacks view derives an "Inactive on your plan" badge and the Register button disables with a tooltip, both from `TierPolicy.entitlements`.
6. Guard test sibling of #184 in `tools.service.test.ts`: restrictive tier (empty allowlist, `customToolpacks: false`) → built tool set contains only system tools; permissive tier → identical to today's full set. A construction path that skips the filter fails by enumeration.
7. Seed: `seedTiers` creates `standard` with the fully-permissive entitlements; the update-if-changed convergence **excludes** the entitlement columns so operator edits survive re-seeds. This is an explicitly **interim** posture: #218 (declarative tier catalog + `portalai tier apply`, per-env Stripe via lookup keys) supersedes it as the record of truth for all catalog-owned fields — see resolved OQ1/OQ2.

## Open questions

1. **Seed convergence vs operator edits — RESOLVED (2026-07-15) → #218.** The underlying defect is two writers with no record of truth (seed constants vs ad-hoc SQL), aggravated by per-environment Stripe sandboxes making tier rows inherently env-local (`stripe_price_id` can never be copied between envs). The durable answer is a **declarative tier catalog applied per environment** (`portalai tier apply`, Stripe `lookup_key` as the cross-env price join) — filed as #218; convergence becomes *safe* there because the catalog is the single authoritative source and drift heals toward declared intent. **For this ticket (interim):** entitlements are set by the migration backfill and on seed INSERT, and are **excluded** from `seedTiers`' update-if-changed — operator edits durable, two-writer risk contained until #218 lands. Spec pins it with a test: tighten standard by SQL, run `seedTiers`, entitlements survive while `selectable` still heals.
2. **New built-in pack ships later — RESOLVED (2026-07-15) → #218.** Explicit-allowlist fail-closed stands (a new pack grants nothing until tiers list it). Interim: release-checklist note + a startup `warn` when the registry carries slugs no live tier row lists. #218 turns the rollout into a catalog edit + per-env apply.
3. **Is registration the only gated toolpack mutation?** Refresh/delete on an unentitled org's existing packs could also 403, but that blocks cleanup and contradicts non-destructive downgrade ergonomics. **Lean:** gate register only; management of existing rows stays open (their tools are already excluded from build).
4. **Where does the web read entitlements for the badge/disabled state?** A dedicated endpoint vs the existing usage response. **Lean:** reuse `GET /api/organization/usage` (`tier: TierPolicy` already in the payload); no new endpoint.
5. **Does the allowlist also constrain the cost gate or `perToolCaps`?** **Lean:** no — an unentitled pack's tools never exist, so the gate never sees them; entitlements and cost stay orthogonal axes (per the ticket's out-of-scope).

## Enterprise-scale considerations

- **Concurrency & correctness** — enforcement is read-only projection of a cached row; no check-then-act to race. The register-403 check vs a concurrent tier downgrade is a benign, non-monetary race (worst case: one pack registered seconds before downgrade, immediately inert). **Lean:** no locking; document the race as accepted.
- **Accuracy & auditability** — tier-row entitlement edits are operator SQL actions with no audit trail today, same as #172's economics columns (#172 Q6 deferred tier-change audit; `stripe_events` audits tier *assignment*, not row edits). **Lean:** inherit the deferral here; #218's catalog (git history) + `portalai` audit trail becomes the durable answer.
- **Failure modes** — fail-closed by construction: no resolvable policy ⇒ no pack tools (a DB outage already fails the whole session build). `resolveTier`'s unknown-slug → `standard` fallback means a typo'd org tier grants standard's entitlements — logged today (`tier.service.ts:72`), acceptable. **Lean:** no blanket fail-open anywhere on this path.
- **Scale & unbounded growth** — allowlist cardinality is bounded by the pack registry (single digits); JSONB read rides the existing 60s slug-keyed cache. **N/A beyond that.**
- **Multi-tenancy** — per-org by construction (org → tier row); a noisy tenant cannot affect another's entitlements. **N/A.**
- **Contract stability** — `entitlements` is an additive-open object: per-pack entitlement metadata (e.g. tool-count limits, #179 ledger hooks, plan-list display) extend it without reshaping `TierPolicy`; #176's `GET /api/billing/tiers` returns whole-tier objects precisely so display can later include it. **Lean:** object (not bare array) for this reason.
- **Data lifecycle** — no periods/windows; entitlements are current-state config. **N/A.**

## What this doesn't decide

- **Which exclusions each tier ships with / how many tiers exist** — product data, edited later; deploy day is zero-change (standard permissive).
- **Entitlement display in the billing plan list** — follow-up on #176's tab; the contract merely doesn't preclude it.
- **Admin UI for editing entitlements** — rows via seed/SQL/`portalai` CLI, consistent with tier economics.
- **Cross-environment tier provisioning** — the declarative catalog + `portalai tier apply` (per-env Stripe sandboxes joined by price `lookup_key`) is #218; this ticket ships the columns and enforcement it will provision.
- **Per-tool (rather than per-pack) entitlements** — `perToolCaps` already covers per-tool *cost* caps; availability stays pack-granular until a real need appears.
- **Tier-change audit trail** — #172 Q6's deferral stands.

## Next step

`docs/TIER_TOOLPACK_ENTITLEMENTS.spec.md` (contract: schema/columns, `TierPolicy.entitlements`, builder filter semantics, `TOOLPACK_NOT_ENTITLED`, guard-test cases, migration/seed) then `docs/TIER_TOOLPACK_ENTITLEMENTS.plan.md` — likely 3 slices: (1) schema + model + migration/backfill + seed (inert, nothing reads it); (2) enforcement — builder filter + registration 403 + the guard test; (3) web — inactive badge + disabled Register affordance + doc-sync (glossary/FAQ touch if any).
