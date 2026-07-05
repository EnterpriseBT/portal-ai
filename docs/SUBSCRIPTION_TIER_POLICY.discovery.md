# Subscription tier policy — Discovery

**Issue:** [EnterpriseBT/portal-ai#172](https://github.com/EnterpriseBT/portal-ai/issues/172)

**Consumed by:** [#169](https://github.com/EnterpriseBT/portal-ai/issues/169) (the uniform tool cost gate — reads `resolveTier(org) → TierPolicy` for its allocation numbers and feeds this ticket's Settings surface the consumption figure). **Later consumer:** a payment-provider ticket that writes the tier *name* from subscription webhooks.

**Why this exists.** The per-org **subscription tier** has no home in the system today — a repo-wide grep for `tier` / `subscription` / `plan` / `quota` / `billing` / `allocation` finds **zero** prior art (the only `tier` hits are unrelated SQL job-tier escalation). Yet the cost gate (#169) can't enforce "deny when the tier is exhausted" without a frozen answer to "what does a tier grant." This ticket models the tier as a first-class domain object: a **`TierPolicy`** declaring a **monthly unit allocation per cost class** (`free | metered | expensive`), resolved by `resolveTier(org)`, persisted via a `tier` name column on organizations, surfaced read-only in Settings → Organization, and shaped so a payment provider later writes the name with no downstream change. This is the **declaration half** of the tool cost contract — the allocation surface #169's enforcement half consumes.

## The current shape

### Organizations dual-schema (greenfield for `tier`)

| Touch point | File | Note |
|---|---|---|
| Drizzle table | `apps/api/src/db/schema/organizations.table.ts:1-16` | `name, timezone, ownerUserId, defaultStationId` after `baseColumns`. Add `tier: text("tier").notNull().default("standard")`. |
| Zod core model | `packages/core/src/models/organization.model.ts:12-17` | `OrganizationSchema` extends `CoreSchema`. Add `tier: z.string()`. |
| drizzle-zod | `apps/api/src/db/schema/zod.ts:50-58` | `createSelectSchema`/`createInsertSchema` auto-infer from the table — no manual edit. |
| Type-checks | `apps/api/src/db/schema/type-checks.ts:119-129` | Bidirectional `IsAssignable` guards; **CI fails** if the column and model diverge — forces the dual-schema sync. |
| Migration | `apps/api/drizzle/` | `npm run db:generate -- --name add_tier_to_organizations` then `db:migrate`. |

### How `tier` reaches the frontend (automatic)

`GET /api/organization/current` (`organization.router.ts:152-222`) → `ApplicationService.getCurrentOrganization` (`application.service.ts:20-42`) → `findById`, returned via `HttpService.success<OrganizationGetResponse>`. The response contract `OrganizationGetResponseSchema` (`organization.contract.ts:7-13`) **wraps `OrganizationSchema` directly** — no field allowlist or mapper. Adding `tier` to the model makes it flow to `OrganizationGetResponse`, `sdk.organizations.current()`, and the Settings tab with **no API change**.

### Settings → Organization tab

`Settings.view.tsx:104-150` renders the Organization tab as a read-only `<MetadataList>` of `{ label, value }` items (Timezone, Created, Updated) fed by `sdk.organizations.current()` (line 22). New rows (tier + units) are additional items in that array.

### Cost classes (the allocation keys)

`CostHintSchema = z.enum(["free", "metered", "expensive"])` at `tool-capability.model.ts:95-99` — the three classes `TierPolicy.allocations` is keyed by. Already the vocabulary #169's gate branches on.

### Config/registry precedent

`environment.ts:47-158` uses `parseInt(process.env.VAR || String(default), 10)` for **scalar** config. Named object sets live as registries in `packages/core/src/registries/` (e.g. `builtin-toolpacks.ts:30-41`, a slug enum + a data map). Tier definitions are object allocations, not scalars — the registry pattern fits; env does not.

## The design space

### Decision 1 — Where tier definitions live

| | A — env scalars | B — core registry (`TIER_REGISTRY`) | C — DB `tiers` table + FK |
|---|---|---|---|
| Fits object allocations | no (scalars only) | **yes** | yes |
| v1 cost | many env vars, no structure | one registry file | table + repo + joins + admin |
| Monetization path | messy | swap registry for a table read behind `resolveTier` | already there (premature) |

**Lean: B.** A `TIER_REGISTRY` in `packages/core/src/registries/` mirroring `builtin-toolpacks.ts`: a tier-name enum + a `Record<TierName, TierPolicy>` map, keyed by `CostHintSchema` values. Individual allocation numbers may still be env-overridable via the `parseInt` pattern for ops tuning, but the *structure* is the registry. Graduating to a DB table later is hidden behind `resolveTier`.

### Decision 2 — The `TierPolicy` shape

**Lean:** the contract #169 already designed against:

```
TierPolicy = {
  tier: string,                            // the name
  period: { kind: "monthly", anchorDay },  // contract-aligned billing window
  allocations: {                           // keyed by CostHintSchema
    free:      { unitsPerPeriod, ratePerMin },   // typically unlimited/no-op
    metered:   { unitsPerPeriod, ratePerMin },
    expensive: { unitsPerPeriod, ratePerMin },
  },
  perToolCaps?: Record<toolName, { unitsPerPeriod }>,
  overage: "hard-deny" | "soft-alert",
}
```

`free` is present for symmetry (the gate checks all classes) but typically unbounded. `perToolCaps` and `overage` are optional levers #169 honors.

### Decision 3 — The `tier` column: name vs FK

**Lean: `tier TEXT NOT NULL DEFAULT 'standard'`** holding the tier *name*; the registry (Decision 1) resolves the name → `TierPolicy`. A FK to a `tiers` table is the monetization graduation, not v1 — the name column is exactly what a payment provider later writes, and keeping it a plain string keeps the column **provider-agnostic** (no `stripe_*` columns).

### Decision 4 — `resolveTier` location & purity

**Lean: a pure core function `tierPolicyFor(name: string) → TierPolicy` + a thin api `resolveTier(org)` wrapper.** The name→policy map is in-memory (the registry), so resolution is a pure synchronous lookup with no I/O; only reading `org.tier` touches the DB, and that's where `organizationId` is already resolved (#169's gate closes over it). Keeping the map pure and in core lets #169 consume it without an api round-trip.

### Decision 5 — Settings display: allocation now, consumption later

**Lean:** add a "Subscription Tier" row (the name, presentably labeled) and a "Units available" row (allocation per class from `resolveTier`) to the `MetadataList`. The **consumption** figure (used this period) is #169's — the widget shows allocation immediately and gains used/remaining once #169's usage read exists. This ticket ships the tier + allocation display; #169 enriches it.

## Tradeoff comparison

| | D1: core registry | D2: TierPolicy shape | D3: name column | D4: pure resolveTier | D5: alloc-now display |
|---|---|---|---|---|---|
| Spread to spec | registry file + enum | the type + Zod schema | 1 column dual-schema | core fn + api wrapper | 2 `MetadataList` rows |
| New infra | 1 core registry | none (a type) | 1 column + migration | none | none |
| Reuses | `builtin-toolpacks` pattern | `CostHintSchema` | dual-schema workflow | registry lookup | `Settings.view` + `sdk.organizations.current` |

## Recommendation

1. **Add `tier TEXT NOT NULL DEFAULT 'standard'`** to `organizations` via the full dual-schema recipe + named migration; it auto-flows to `OrganizationGetResponse`.
2. **Define `TierPolicy`** (Decision 2) as a Zod schema in core, allocations keyed by `CostHintSchema`.
3. **A `TIER_REGISTRY` in `packages/core/src/registries/`** — a tier-name enum + `Record<TierName, TierPolicy>`, allocation numbers env-overridable, mirroring `builtin-toolpacks.ts`.
4. **Pure `tierPolicyFor(name) → TierPolicy` in core + thin `resolveTier(org)` in api** — the single seam #169 consumes; unknown names fall back to the default tier (never throw — see Enterprise considerations).
5. **Settings → Organization** gains a tier row + a units-available (allocation) row; consumption is fed by #169.
6. **Provider-agnostic** — no payment SDK, webhooks, or customer/subscription columns; the name column is the future write target.

## Open questions

1. **Real allocation numbers for `standard` now, or placeholders?** **Lean: real, conservative, env-overridable numbers** in the registry — the gate (#169) needs meaningful limits to prove enforcement, and a placeholder would ship a meaningless cap.
2. **Per-org custom allocations (enterprise bespoke deals) before a `tiers` table exists?** **Lean: no in v1** — the registry is the source; a custom-deal override is the DB-table graduation. Flag so the spec doesn't model per-org override columns yet.
3. **Billing-period anchor: calendar month vs org anniversary?** **Lean: calendar month, `anchorDay: 1` default** for v1 — there's no payment provider yet to supply a contract anchor; the `period` field exists so the provider later supplies the real anchor without a schema change.
4. **Does `resolveTier` need to be async?** **Lean: no** — name→policy is a pure in-memory map lookup; only fetching `org.tier` is I/O, and that's already resolved where the gate runs.
5. **Should tier *changes* be audited (who/when moved an org between tiers)?** **Lean: rely on `baseColumns` `updated`/`updatedBy` for v1**; a dedicated tier-change audit log is a monetization/compliance concern for the payment ticket.

## Enterprise-scale considerations

_(Dogfooding [#173](https://github.com/EnterpriseBT/portal-ai/issues/173) — the discovery-lens convention this session spun out.)_

- **Contract stability** — `resolveTier` is the *single* seam; graduating config-registry → DB table (paid tiers) changes no consumer call site. This is the whole point of shaping `tier` as a name + resolver now.
- **Failure modes** — `resolveTier` on an unknown/legacy/blank tier name must **fall back to the default tier, never throw**: it runs inside #169's gate prelude on every tool call, so a throw would break tool execution. Fail-safe to `standard`, log a warning.
- **Data lifecycle** — the billing window is `TierPolicy.period`, aligned to contract semantics, not an arbitrary technical window. v1 uses calendar-month/day-1; the field is present so a real contract anchor slots in later.
- **Multi-tenancy** — tier is strictly per-org; there is no cross-tenant shared allocation. Noisy-neighbor protection is #169's enforcement job, not this contract's.
- **Auditability** — allocation numbers are the contract of record (registry, version-controlled); consumption accuracy/audit is #169's ledger. Tier-change audit is deferred (Open Q5).

## What this doesn't decide

- **Enforcement / metering / counting / deny** — that's #169, which consumes `TierPolicy`.
- **`resolveCallCost` / per-tool unit weights** — how many units a call charges is #169's; this ticket only defines the allocation charged against.
- **Payment provider integration** (Stripe SDK, subscription webhooks, customer/subscription columns) — a later ticket that *writes* the tier name.
- **Admin UI to create/edit tiers** — tiers are config-defined here.
- **A `tiers` DB table + per-org custom allocations** — the monetization graduation (Open Q2), behind the unchanged `resolveTier` seam.

## Next step

Write `docs/SUBSCRIPTION_TIER_POLICY.spec.md` (contract: the `TierPolicy` Zod schema, the `TIER_REGISTRY` shape + default tier, `tierPolicyFor`/`resolveTier` signatures + fallback behavior, the `tier` column dual-schema, and the Settings row shape) and `.plan.md` (TDD slices). Likely slicing: (1) `TierPolicy` type + `TIER_REGISTRY` + `tierPolicyFor` (pure core, unit-tested); (2) `tier` column dual-schema + migration + `resolveTier(org)` wrapper (auto-flows to `OrganizationGetResponse`); (3) Settings → Organization tier + allocation rows + a render test. Each slice green and independent. #169's spec unblocks once slices 1–2 freeze the contract.
