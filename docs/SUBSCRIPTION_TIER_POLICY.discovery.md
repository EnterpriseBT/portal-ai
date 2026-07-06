# Subscription tier policy — Discovery

**Issue:** [EnterpriseBT/portal-ai#172](https://github.com/EnterpriseBT/portal-ai/issues/172)

**Consumed by:** [#169](https://github.com/EnterpriseBT/portal-ai/issues/169) (the uniform tool cost gate — reads `resolveTier(org) → TierPolicy` for its allocation numbers and *increments* this ticket's per-org usage balance as it charges). **Later consumer:** a payment-provider ticket that writes the org's tier *slug* and manages tier rows from subscription webhooks.

> **Cross-ticket sync (deferred).** #169's discovery still says its own ledger owns "used-this-period" and *feeds* this display. With Decision 6, that inverts: #172 owns the durable usage balance and #169 *increments* it. #169's doc is **not** edited yet — no committed plan/impl there — and will be reconciled when #169 resumes (after this ticket merges).

**Why this exists.** The per-org **subscription tier** has no home in the system today — a repo-wide grep for `tier` / `subscription` / `plan` / `quota` / `billing` / `allocation` finds **zero** prior art (the only `tier` hits are unrelated SQL job-tier escalation). Yet the cost gate (#169) can't enforce "deny when the tier is exhausted" without a frozen answer to "what does a tier grant, and how much is left." This ticket models the tier as a first-class domain object — the **accounting** side of the tool cost contract: a `tiers` table whose rows declare a **monthly unit allocation per cost class** (`free | metered | expensive`) as a `TierPolicy`, resolved by `resolveTier(org)`; a per-org **usage** balance (units used → units available); and the read-only Settings → Organization display of both. The org carries a `tier` *slug* a payment provider later writes. #169 is the **enforcement** side: it reads the allocation and increments the usage. This ticket owns *what you get and what's left*; #169 owns *stopping you when it's gone*.

## The current shape

### Organizations dual-schema (greenfield for `tier`)

| Touch point | File | Note |
|---|---|---|
| Drizzle table | `apps/api/src/db/schema/organizations.table.ts:1-16` | `name, timezone, ownerUserId, defaultStationId` after `baseColumns`. Add `tier: text("tier").notNull().default("standard").references(() => tiers.slug)`. |
| Zod core model | `packages/core/src/models/organization.model.ts:12-17` | `OrganizationSchema` extends `CoreSchema`. Add `tier: z.string()`. |
| drizzle-zod | `apps/api/src/db/schema/zod.ts:50-58` | `createSelectSchema`/`createInsertSchema` auto-infer from the table — no manual edit. |
| Type-checks | `apps/api/src/db/schema/type-checks.ts:119-129` | Bidirectional `IsAssignable` guards; **CI fails** if the column and model diverge — forces the dual-schema sync. |
| Migration | `apps/api/drizzle/` | `npm run db:generate -- --name add_tier_to_organizations` then `db:migrate`. |

Plus **two new tables** built via the same five-step recipe: `tiers` (the definitions — Decisions 1/1b) and `usage` (per-org-per-period balances — Decision 6), each with a `*.model.ts` in core, a Drizzle `*.table.ts`, drizzle-zod entries, type-checks, and a migration; `tiers` also gets a `db:seed` for the default row.

### How `tier` reaches the frontend (automatic)

`GET /api/organization/current` (`organization.router.ts:152-222`) → `ApplicationService.getCurrentOrganization` (`application.service.ts:20-42`) → `findById`, returned via `HttpService.success<OrganizationGetResponse>`. The response contract `OrganizationGetResponseSchema` (`organization.contract.ts:7-13`) **wraps `OrganizationSchema` directly** — no field allowlist or mapper. Adding `tier` to the model makes it flow to `OrganizationGetResponse`, `sdk.organizations.current()`, and the Settings tab with **no API change**.

### Settings → Organization tab

`Settings.view.tsx:104-150` renders the Organization tab as a read-only `<MetadataList>` of `{ label, value }` items (Timezone, Created, Updated) fed by `sdk.organizations.current()` (line 22). New rows (tier + units) are additional items in that array.

### Cost classes (the allocation keys)

`CostHintSchema = z.enum(["free", "metered", "expensive"])` at `tool-capability.model.ts:95-99` — the three classes `TierPolicy.allocations` is keyed by. Already the vocabulary #169's gate branches on.

### Data-config precedent (tiers + usage as rows)

Tier economics are business config that should be *data, not code*: `environment.ts:47-158` (`parseInt` env scalars) suits ops toggles, not a growing set of priced tiers. The dual-schema table workflow + the `Repository<...>` base (`apps/api/src/db/repositories/`) + `db:seed` are the home — a `tiers` table seeds its default row and grows by `INSERT`, a `usage` table holds per-org-per-period balances, and a future Stripe webhook points an org at a row. (The `builtin-toolpacks.ts:30-41` registry is the *code*-config precedent we deliberately are **not** using here — tier numbers must change without a deploy.)

## The design space

### Decision 1 — Where tier definitions live

| | A — env scalars | B — core registry (`TIER_REGISTRY`) | C — DB `tiers` table |
|---|---|---|---|
| Fits object allocations | no (scalars only) | yes | **yes** |
| Add a tier later | no | code change + deploy | **row `INSERT`** |
| Change a unit charge | redeploy | redeploy | **SQL `UPDATE`** |
| Set the default tier | env default | code | **`db:seed`** |
| Stripe path (webhook → tier) | awkward | code map + deploy | **webhook points org at a row** |
| v1 cost | many env vars | one registry file | table + model + repo + seed; `resolveTier` becomes a DB read |

**Lean: C — a `tiers` table.** Tier definitions live in the DB: add a tier with an `INSERT`, change a unit charge with an `UPDATE`, seed the default `standard` tier via `db:seed`, and let a future Stripe webhook map a price → a tier row — all with **no deploy**. Costs a `tier.model.ts` + Drizzle table (dual-schema) + a `TiersRepository` + a seed, and makes `resolveTier` a (cached) DB read rather than a map lookup (Decision 4). Worth it: tier economics are exactly the kind of business config that should be *data, not code*. _(Reverses this doc's original lean toward B — see the decision below on how the row is shaped.)_

### Decision 1b — How allocations are stored on a tier row

`TierPolicy` (Decision 2) is nested — a cost-class charge grid plus the variable `perToolCaps`, `period`, `overage`. Three ways to land it in the table:

| | scalar columns | JSONB policy column | child tables |
|---|---|---|---|
| "change a charge" ergonomics | **easiest** (`SET metered_units=…`) | `jsonb_set` | join + update |
| holds variable `perToolCaps` | no | **yes** | yes |
| dual-schema fit | wide flat table | jsonb typed by Zod | 2–3 tables + repos |

**Decided: hybrid.** Scalar columns for the **fixed cost-class charge grid** (`{free,metered,expensive}` × `{unitsPerPeriod, ratePerMin}` = 6 columns) so "change a charge" is a plain `UPDATE` — honoring the whole reason we went to a table — plus scalars for `slug`, `display_name`, `period_kind`, `period_anchor_day`, `overage`, and a **JSONB `per_tool_caps`** for the one variable-length bit. Rationale: the charge grid is small and *fixed* (the `CostHintSchema` enum — adding a class is already a code-wide change), so scalar columns give the best edit ergonomics, strong DB integrity (`CHECK ≥ 0`; nullable, where `NULL` = unlimited per Decision 2b), and trivial queryability, with the "column-add migration" downside barely applying; `perToolCaps` is the only genuinely variable piece, so it goes JSONB. `resolveTier` assembles a `TierPolicy` from the row (a small, well-contained mapping). All-JSONB was rejected: zero-migration flexibility isn't worth losing the clean `SET col = n` that motivated the table.

### Decision 2 — The `TierPolicy` shape

**Decided:** the object `resolveTier` assembles from a tier row and hands #169:

```
TierPolicy = {
  tier: string,                                  // the slug that resolved
  period: { kind: "monthly", anchorDay },        // billing window (Open Q3)
  allocations: {                                 // keyed by CostHintSchema
    free:      { unitsPerPeriod, ratePerMin },
    metered:   { unitsPerPeriod, ratePerMin },
    expensive: { unitsPerPeriod, ratePerMin },
  },
  perToolCaps?: Record<toolName, { unitsPerPeriod }>,
  overage: "hard-deny" | "soft-alert",
}
```

- **2a — `ratePerMin` stays in the tier.** Two distinct limits ride here: `unitsPerPeriod` (the monthly **quota** — subscription economics) and `ratePerMin` (a **burst rate-limit** — system/upstream protection). Both are per-plan levers #169 reads from one place. Noted: `ratePerMin` is protection riding on the subscription object, not revenue — if rate-limits ever want to be global system config, they drop out of the tier without touching the quota path.
- **2b — `NULL` means unlimited.** Both `unitsPerPeriod` and `ratePerMin` are nullable; `NULL` = no cap and the gate skips that class's check (how `free` is uncapped, and how an `enterprise` tier can be uncapped on `metered`). Cleaner and more self-documenting than a `-1` sentinel.
- **2c — `overage` is per-tier for v1.** One setting for the whole tier (`hard-deny` vs `soft-alert`); per-cost-class overage is a later additive migration if needed.

### Decision 3 — What the `organizations` column holds

**Lean: `tier TEXT NOT NULL DEFAULT 'standard'` referencing `tiers.slug`** (a FK to the tiers table's unique `slug`). The column still holds the tier *name*, so a payment provider writes a slug and nothing else changes; the FK gives referential integrity (an org can't point at a nonexistent tier), the literal `DEFAULT 'standard'` needs no backfill, and `organizations` stays provider-agnostic (no `stripe_*` columns). A surrogate `tier_id` FK is the alternative but loses the literal-default convenience and the provider-writes-a-name ergonomics.

### Decision 4 — `resolveTier`: async, cached

With definitions in the DB, `resolveTier(org)` is a **DB read**, not a map lookup — and #169's gate calls it on **every tool call**, so an uncached read per call is real hot-path load. **Lean: async `resolveTier(org) → Promise<TierPolicy>` backed by a `TiersRepository`, with a short in-process TTL cache** (tier defs change rarely — a ~60s cache is plenty; invalidate on tier write). Reads `org.tier` (already in scope where the gate runs) → cache-or-fetch the tier row by slug → assemble/validate to `TierPolicy`. Unknown/legacy slug → default tier, never throw (Enterprise considerations).

### Decision 5 — Settings display: tier + used/available, from #172's own data

**Lean:** the Organization tab shows the tier name, its **allocation** per cost class (from the tiers row), **units used** this period, and **units available** (= allocation − used) — all read from #172's own data (Decision 6), so the surface is complete in this ticket, not half-owned. Rendered as `MetadataList` rows (or a small usage bar). Before #169's gate is live, `used = 0` and available = full allocation; once the gate increments usage, the same rows reflect real consumption with no frontend change.

### Decision 6 — Tracking units used + computing "available"

"Units used/available" is **accounting state**, and accounting belongs to the subscription/tier domain — not the enforcement mechanism. So #172 owns the durable balance; #169's gate is the hot-path writer.

| | A — read from #169's Redis counter | B — SUM #169's append-only ledger on read | C — #172 owns a per-org-per-period **usage** aggregate table |
|---|---|---|---|
| Durable / queryable for billing & audit | no (ephemeral) | yes but couples #172 to #169 ledger internals | **yes, #172-owned** |
| Read cost for Settings | cheap | SUM per load | **cheap (one row per period/class)** |
| Ownership clean | enforcement owns accounting (inverted) | inverted | **accounting owns accounting** |

**Lean: C.** A `usage` aggregate table (dual-schema): `(organizationId, periodId, costClass, unitsUsed)`, where `periodId` derives from the tier's `period` (same monthly key #169's gate uses). #172 owns the table + the `available = allocation − unitsUsed` read + the Settings display. **#169's gate increments it** as part of its atomic charge (Redis hot counter stays the authoritative *enforcement* state; this table is the durable, queryable balance, kept in sync by the gate's write-through). #169 keeps its per-call **audit ledger** (forensic detail); #172 keeps the **balance** (what a user/billing sees). The increment is a stable service seam the gate calls — the concurrency-safe UPSERT lives here.

## Tradeoff comparison

| | D1: DB `tiers` table | D2: TierPolicy shape | D3: slug FK column | D4: async cached resolveTier | D5/D6: usage + display |
|---|---|---|---|---|---|
| Spread to spec | table + model + repo + seed | the type + Zod schema | 1 column + FK | repo + TTL cache | usage table + available read + rows |
| New infra | `tiers` table, repo, seed | none (a type) | 1 column + FK | in-proc cache | `usage` table + increment seam |
| Reuses | dual-schema + `Repository` base | `CostHintSchema` | dual-schema workflow | `TiersRepository` | dual-schema + `Settings.view` |

## Recommendation

1. **A `tiers` table** (dual-schema `tier.model.ts` + Drizzle table + type-checks + migration) holding per row: `slug`, `display_name`, the scalar cost-class charge grid (`{free,metered,expensive}` × `{unitsPerPeriod, ratePerMin}`), `period_kind`/`period_anchor_day`, `overage`, and JSONB `per_tool_caps`. Add a `TiersRepository` + a `db:seed` for the default `standard` tier.
2. **Define `TierPolicy`** (Decision 2) as the Zod shape `resolveTier` assembles from a tier row; allocations keyed by `CostHintSchema`.
3. **`tier TEXT NOT NULL DEFAULT 'standard'` on `organizations`**, FK → `tiers.slug`; auto-flows to `OrganizationGetResponse`. The slug is the payment provider's future write target.
4. **Async `resolveTier(org) → Promise<TierPolicy>`** backed by `TiersRepository` + a short in-process TTL cache (hot path — #169 calls it per tool call); unknown slug → default tier, never throw.
5. **A per-org-per-period `usage` aggregate table** (`organizationId, periodId, costClass, unitsUsed`) — #172's durable balance. Expose an `available = allocation − unitsUsed` read and a concurrency-safe increment seam #169's gate calls; #169 keeps its per-call audit ledger.
6. **Settings → Organization** shows tier + allocation + used + available, all from #172's own data (tiers + usage); values are real once #169's gate writes usage, `used = 0` before that.
7. **Provider-agnostic** — no payment SDK, webhooks, or customer/subscription columns; tiers are rows and the org slug is the write target.

## Open questions

1. **Seed values for the `standard` tier?** **Lean: real, conservative numbers seeded into the row** — the gate (#169) needs a meaningful cap to enforce, and it's trivially tuned later with an `UPDATE`. No placeholder.
2. **Per-org bespoke allocations (enterprise custom deals)?** **Lean: model a bespoke deal as its own `tiers` row** (e.g. slug `enterprise-acme`) the org points at — not per-org override columns on `organizations`. The tiers table makes arbitrary tiers cheap, so there's one resolution path. Revisit a per-org override table only if bespoke deals proliferate.
3. **Billing-period anchor: calendar month vs org anniversary?** **Lean: calendar month, `anchorDay: 1` default** for v1 — no payment provider yet to supply a contract anchor; the `period_anchor_day` column exists so the provider later sets a real anchor without a schema change.
4. **~~Does `resolveTier` need to be async?~~ [RESOLVED — yes, async + cached.]** DB-backed definitions make it a read; a short in-process TTL cache keeps the per-call hot path cheap (Decision 4).
5. **Usage aggregate: dedicated table vs SUM #169's ledger?** **Lean: dedicated `usage` table (Decision 6C)** — keeps #172's balance read cheap and decoupled from #169's ledger internals; the gate write-through keeps it in sync.
6. **Should tier/charge *changes* be audited (who edited a charge / moved an org)?** **Lean: `baseColumns` `updated`/`updatedBy` on `tiers` + `organizations` for v1** — editing tier economics is now a DB mutation, so who-can-edit + a full change-history is a real enterprise concern, but a dedicated audit log is a monetization/compliance follow-up.

## Enterprise-scale considerations

_(Dogfooding [#173](https://github.com/EnterpriseBT/portal-ai/issues/173) — the discovery-lens convention this session spun out.)_

- **Contract stability** — `resolveTier` (allocation) + the usage-increment seam (consumption) are the two stable interfaces #169 consumes; tiers moving from seed to Stripe-driven rows changes no call site. This is the whole point of shaping `tier` as a slug + resolver + usage seam now.
- **Concurrency & correctness** — the `usage` increment is called from #169's hot path under concurrency; it must be a concurrency-safe UPSERT/atomic increment (Redis counter authoritative for the deny decision, DB balance written through). The per-period key derives from the tier's `period`, matching #169's counter key exactly so the two don't diverge.
- **Scale / hot path** — `resolveTier` runs per tool call, so tier defs are TTL-cached (Decision 4); the `usage` table is one row per `(org, period, class)`, so the Settings balance read is O(1), not a scan.
- **Failure modes** — `resolveTier` on an unknown/legacy/blank slug must **fall back to the default tier, never throw** (it runs inside #169's gate prelude on every tool call; a throw breaks tool execution). Fail-safe to `standard`, log a warning.
- **Accuracy & auditability** — allocations and balances are DB rows (queryable for billing/chargeback); #169 keeps the per-call audit ledger for forensics. Because charges are now *data*, editing tier economics is a privileged, audited action (Open Q6), not a code review — a control worth calling out.
- **Data lifecycle** — the billing window is the tier's `period`, aligned to contract semantics, not an arbitrary technical window. v1 uses calendar-month/day-1; `period_anchor_day` lets a real contract anchor slot in later.
- **Multi-tenancy** — tier + usage are strictly per-org; no cross-tenant shared allocation. Noisy-neighbor protection is #169's enforcement job, not this contract's.

## What this doesn't decide

- **Enforcement mechanics** — the hot-path atomic check-and-charge, `resolveCallCost` / per-tool unit weights, deny results, and the Redis counter are #169's. #172 owns the allocation, the durable balance, and the display; #169 *increments* the balance and denies.
- **The per-call audit ledger** — forensic per-invocation detail stays #169; #172 keeps the per-period balance.
- **Payment provider integration** (Stripe SDK, subscription webhooks, customer/subscription columns) — a later ticket that *writes* the org's tier slug and manages tier rows.
- **Admin UI to create/edit tiers** — tiers are rows edited via `db:seed`/SQL for now; an editing UI is later.
- **Per-org override columns** — a bespoke deal is its own `tiers` row (Open Q2), not per-org allocation columns on `organizations`.

## Next step

Write `docs/SUBSCRIPTION_TIER_POLICY.spec.md` (contract: the `tiers` table + `TierPolicy` Zod shape, the row-shape + seed default, `resolveTier` signature + fallback + caching, the `usage` table + the `available` read + increment seam, the `tier` slug FK column, and the Settings row shape) and `.plan.md` (TDD slices). Likely slicing: (1) `tiers` table dual-schema + `TiersRepository` + `db:seed` default tier + `TierPolicy` Zod shape (unit-tested); (2) `tier` slug column + FK on `organizations` + async cached `resolveTier(org)` (auto-flows to `OrganizationGetResponse`); (3) `usage` aggregate table + `available` read + concurrency-safe increment seam (the interface #169 calls); (4) Settings → Organization tier + allocation + used + available rows + a render test. Each slice green and independent. #169's spec unblocks once slices 1–3 freeze the allocation + usage-increment contracts.
