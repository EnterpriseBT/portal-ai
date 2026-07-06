# Subscription tier policy — Spec

**Issue:** [EnterpriseBT/portal-ai#172](https://github.com/EnterpriseBT/portal-ai/issues/172) · **Epic:** #177 · **Discovery:** `docs/SUBSCRIPTION_TIER_POLICY.discovery.md`

Introduce the per-org **subscription tier** as a first-class, DB-backed domain object: a `tiers` table whose rows declare a monthly **unit allocation per cost class** (assembled into a `TierPolicy`), a per-org **`usage`** balance (`available = allocation − used`), `resolveTier(org)` + a usage-increment seam that the cost gate (#169) consumes, an `organizations.tier` slug FK, and the read-only Settings → Organization display of tier + allocation + used + available. This ticket builds **no enforcement** — #169 reads the allocation and increments the usage; it builds **no payment integration** — #176 writes the slug.

Discovery decisions ratified here (D1–D6, Q1–Q6):

- **D1 — tiers live in a DB table** (not a core registry). Add a tier by `INSERT`, change a charge by `UPDATE`, seed the default via `db:seed`.
- **D1b — hybrid row shape:** scalar cost-class charge grid + JSONB `per_tool_caps` + scalar `slug`/`display_name`/`period`/`overage`.
- **D2 — `TierPolicy` shape:** `ratePerMin` stays in-tier (2a); `NULL` = unlimited (2b); `overage` per-tier (2c).
- **D3 — `organizations.tier` is a slug FK → `tiers.slug`.**
- **D4 — `resolveTier` is async + in-process TTL-cached.**
- **D5/D6 — #172 owns the durable `usage` balance + `available` + the display; #169 increments.**
- **Q1 — seed real, conservative `standard` numbers** (figures set in *Seed* below).
- **Q2 — bespoke deals = their own `tiers` row.** No per-org override columns.
- **Q3 — calendar month, `anchorDay = 1`.** `period_anchor_day` lets a provider set a real anchor later.
- **Q6 — `baseColumns` `updated`/`updatedBy`** for change tracking; a dedicated audit log is deferred.

Cross-ticket seam (from discovery): #169 will consume `TierService.resolveTier` + `UsageService.increment`; #169's own discovery is reconciled when it resumes (noted there and in this ticket's discovery).

---

## Scope

### In scope

1. **`Tier` + `TierPolicy` core models** (`packages/core/src/models/tier.model.ts`) — `TierSchema` (the flat DB-row shape), `TierPolicySchema` (the assembled nested shape consumers read), `TierModel` + `TierModelFactory`.
2. **`Usage` core model** (`packages/core/src/models/usage.model.ts`) — `UsageSchema`, `UsageModel` + `UsageModelFactory`.
3. **`tiers` Drizzle table** (`apps/api/src/db/schema/tiers.table.ts`) — hybrid row + unique `slug` + `CHECK`s.
4. **`usage` Drizzle table** (`apps/api/src/db/schema/usage.table.ts`) — `(organizationId, periodId, costClass, unitsUsed)` + unique index.
5. **`organizations.tier` column** — `text NOT NULL DEFAULT 'standard'` FK → `tiers.slug`; dual-schema.
6. **drizzle-zod + type-checks** for `tiers`, `usage`, and the updated `organizations`.
7. **`TiersRepository` + `UsageRepository`** + registration on `DbService.repository`.
8. **`TierService`** — `resolveTier(org): Promise<TierPolicy>` (async, TTL-cached, default-tier fallback) + `tierPolicyFromRow(row)` assembly + `periodIdFor(period, at)` helper.
9. **`UsageService`** — `increment(orgId, costClass, units, periodId, client?)` (concurrency-safe UPSERT — the seam #169 calls) + `getBalance(org, tierPolicy)` (`available = allocation − used`).
10. **Read endpoint** `GET /api/organization/usage` → `{ tier: TierPolicy, usage: { periodId, byClass } }` for the Settings tab.
11. **`tier` on `OrganizationSchema`** so the raw slug also rides `OrganizationGetResponse`.
12. **`db:seed` default `standard` tier row.**
13. **Settings → Organization display** — tier + allocation + used + available rows.
14. **Contracts** (`tier.contract.ts`) — `TierPolicy` + the usage-read payload.

### Out of scope

- **Enforcement** — the hot-path atomic check-and-charge, `resolveCallCost`, deny, the Redis counter, the per-call audit ledger — all #169. This ticket exposes the allocation + the increment seam; it does not call them.
- **Payment provider** — Stripe SDK, webhooks, `stripe_*` columns — #176.
- **Admin UI to edit tiers** — rows are edited via `db:seed`/SQL.
- **Per-org override columns / registration entitlement** (`maxCustomToolpacks`) — deferred (discovery Open Q2 / What-this-doesn't-decide).
- **Usage history / charts** — only the current-period balance ships.

---

## Surface

### `Tier` + `TierPolicy` models

**File: `packages/core/src/models/tier.model.ts`** (new) — mirrors the `user.model.ts` layering.

```ts
import { z } from "zod";
import { CoreSchema, CoreModel, ModelFactory } from "./base.model.js";
import { CostHintSchema } from "./tool-capability.model.js";

/** One cost class's allocation. NULL unitsPerPeriod/ratePerMin = unlimited (D2b). */
const AllocationSchema = z.object({
  unitsPerPeriod: z.number().int().nonnegative().nullable(),
  ratePerMin: z.number().int().nonnegative().nullable(),
});

export const TierPeriodSchema = z.object({
  kind: z.literal("monthly"),
  anchorDay: z.number().int().min(1).max(28),
});

export const OverageSchema = z.enum(["hard-deny", "soft-alert"]);

/** The assembled, nested shape consumers (#169, Settings) read. */
export const TierPolicySchema = z.object({
  tier: z.string(),                    // the slug that resolved
  period: TierPeriodSchema,
  allocations: z.object({
    free: AllocationSchema,
    metered: AllocationSchema,
    expensive: AllocationSchema,
  }),
  perToolCaps: z.record(z.string(), z.object({ unitsPerPeriod: z.number().int().nonnegative() })).nullable(),
  overage: OverageSchema,
});
export type TierPolicy = z.infer<typeof TierPolicySchema>;

/** The flat DB-row shape (hybrid, D1b) — must match the Drizzle table for type-checks. */
export const TierSchema = CoreSchema.extend({
  slug: z.string(),
  displayName: z.string(),
  periodKind: z.literal("monthly"),
  periodAnchorDay: z.number().int().min(1).max(28),
  overage: OverageSchema,
  freeUnitsPerPeriod: z.number().int().nonnegative().nullable(),
  freeRatePerMin: z.number().int().nonnegative().nullable(),
  meteredUnitsPerPeriod: z.number().int().nonnegative().nullable(),
  meteredRatePerMin: z.number().int().nonnegative().nullable(),
  expensiveUnitsPerPeriod: z.number().int().nonnegative().nullable(),
  expensiveRatePerMin: z.number().int().nonnegative().nullable(),
  perToolCaps: z.record(z.string(), z.object({ unitsPerPeriod: z.number().int().nonnegative() })).nullable(),
});
export type Tier = z.infer<typeof TierSchema>;

export class TierModel extends CoreModel<Tier> {
  get schema() { return TierSchema; }
  parse(): Tier { return this.schema.parse(this._model); }
  validate() { return this.schema.safeParse(this._model); }
}

export class TierModelFactory extends ModelFactory<Tier, TierModel> {
  create(createdBy: string): TierModel {
    return new TierModel(this._coreModelFactory.create(createdBy).toJSON());
  }
}
```

`CostHintSchema` (`tool-capability.model.ts:98`, `"free" | "metered" | "expensive"`) is the authority for the class keys; `TierPolicy.allocations` and `usage.costClass` both key by it.

### `Usage` model

**File: `packages/core/src/models/usage.model.ts`** (new)

```ts
export const UsageSchema = CoreSchema.extend({
  organizationId: z.string(),
  periodId: z.string(),                 // e.g. "2026-07" (TierService.periodIdFor)
  costClass: CostHintSchema,
  unitsUsed: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof UsageSchema>;
// UsageModel / UsageModelFactory mirror TierModel above.
```

### `tiers` table

**File: `apps/api/src/db/schema/tiers.table.ts`** (new)

```ts
import { pgTable, text, integer, jsonb, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";

export const tiers = pgTable(
  "tiers",
  {
    ...baseColumns,
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    periodKind: text("period_kind").notNull().default("monthly"),
    periodAnchorDay: integer("period_anchor_day").notNull().default(1),
    overage: text("overage").notNull().default("hard-deny"),
    // charge grid — nullable; NULL = unlimited (D2b)
    freeUnitsPerPeriod: integer("free_units_per_period"),
    freeRatePerMin: integer("free_rate_per_min"),
    meteredUnitsPerPeriod: integer("metered_units_per_period"),
    meteredRatePerMin: integer("metered_rate_per_min"),
    expensiveUnitsPerPeriod: integer("expensive_units_per_period"),
    expensiveRatePerMin: integer("expensive_rate_per_min"),
    perToolCaps: jsonb("per_tool_caps").$type<Record<string, { unitsPerPeriod: number }>>(),
  },
  (t) => [
    // FULL unique CONSTRAINT (not a soft-delete-partial index): it is the FK
    // target of `organizations.tier`, and Postgres requires a non-partial
    // UNIQUE/PK for a referenced column. A soft-deleted tier's slug therefore
    // cannot be reused — acceptable: tiers are rarely deleted and never while
    // an org references one (the FK blocks it).
    unique("tiers_slug_unique").on(t.slug),
    check("tiers_overage_check", sql`${t.overage} IN ('hard-deny', 'soft-alert')`),
    check("tiers_period_kind_check", sql`${t.periodKind} IN ('monthly')`),
    check("tiers_anchor_day_check", sql`${t.periodAnchorDay} BETWEEN 1 AND 28`),
    // each charge column, when present, is non-negative
    check("tiers_charges_nonneg", sql`
      (${t.freeUnitsPerPeriod} IS NULL OR ${t.freeUnitsPerPeriod} >= 0) AND
      (${t.meteredUnitsPerPeriod} IS NULL OR ${t.meteredUnitsPerPeriod} >= 0) AND
      (${t.expensiveUnitsPerPeriod} IS NULL OR ${t.expensiveUnitsPerPeriod} >= 0) AND
      (${t.freeRatePerMin} IS NULL OR ${t.freeRatePerMin} >= 0) AND
      (${t.meteredRatePerMin} IS NULL OR ${t.meteredRatePerMin} >= 0) AND
      (${t.expensiveRatePerMin} IS NULL OR ${t.expensiveRatePerMin} >= 0)`),
  ]
);
```

### `usage` table

**File: `apps/api/src/db/schema/usage.table.ts`** (new)

```ts
export const usage = pgTable(
  "usage",
  {
    ...baseColumns,
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    periodId: text("period_id").notNull(),
    costClass: text("cost_class").notNull(),
    unitsUsed: integer("units_used").notNull().default(0),
  },
  (t) => [
    uniqueIndex("usage_org_period_class_unique")
      .on(t.organizationId, t.periodId, t.costClass)
      .where(sql`deleted IS NULL`),
    check("usage_cost_class_check", sql`${t.costClass} IN ('free', 'metered', 'expensive')`),
    check("usage_units_nonneg", sql`${t.unitsUsed} >= 0`),
  ]
);
```

### `organizations.tier` column

**File: `apps/api/src/db/schema/organizations.table.ts`** — add:

```ts
tier: text("tier").notNull().default("standard").references(() => tiers.slug),
```

**File: `packages/core/src/models/organization.model.ts`** — add `tier: z.string()` to `OrganizationSchema`.

### drizzle-zod (`apps/api/src/db/schema/zod.ts`)

Add, mirroring the organizations block:

```ts
export const TierSelectSchema = createSelectSchema(tiers);
export const TierInsertSchema = createInsertSchema(tiers);
export type TierSelect = z.infer<typeof TierSelectSchema>;
export type TierInsert = z.infer<typeof TierInsertSchema>;

export const UsageSelectSchema = createSelectSchema(usage);
export const UsageInsertSchema = createInsertSchema(usage);
export type UsageSelect = z.infer<typeof UsageSelectSchema>;
export type UsageInsert = z.infer<typeof UsageInsertSchema>;
```

### type-checks (`apps/api/src/db/schema/type-checks.ts`)

Add the three bidirectional assertions per new entity (mirroring the `Organization` block at `:116-129`), e.g. for `Tier`:

```ts
type _TierDrizzleToModel = IsAssignable<TierSelect, Tier>;   const _t1: _TierDrizzleToModel = true;
type _TierModelToDrizzle = IsAssignable<Tier, TierSelect>;   const _t2: _TierModelToDrizzle = true;
type _TierInferredToModel = IsAssignable<InferSelectModel<typeof tiers>, Tier>; const _t3: _TierInferredToModel = true;
```

Same for `Usage`. The `Organization` block gains no new assertion (the added `tier: z.string()` is covered by the existing pair). **These guards are the dual-schema enforcement — a mismatch fails `type-check`.**

### Repositories

**File: `apps/api/src/db/repositories/tiers.repository.ts`** (new)

```ts
export class TiersRepository extends Repository<typeof tiers, TierSelect, TierInsert> {
  constructor() { super(tiers); }
  async findBySlug(slug: string, client: DbClient = db): Promise<TierSelect | undefined> {
    const [row] = await (client as typeof db).select().from(this.table)
      .where(and(eq(tiers.slug, slug), this.notDeleted())).limit(1);
    return row as TierSelect | undefined;
  }
}
export const tiersRepo = new TiersRepository();
```

**File: `apps/api/src/db/repositories/usage.repository.ts`** (new) — the increment is the concurrency-safe seam:

```ts
export class UsageRepository extends Repository<typeof usage, UsageSelect, UsageInsert> {
  constructor() { super(usage); }

  /** Atomic per-(org,period,class) increment — the seam #169's gate calls.
   *  ON CONFLICT DO UPDATE guarantees correctness under concurrent charges. */
  async increment(
    organizationId: string, periodId: string, costClass: CostHint,
    units: number, actor: { userId: string }, client: DbClient = db,
  ): Promise<void> {
    await (client as typeof db).insert(usage)
      .values({ /* baseColumns via factory */, organizationId, periodId, costClass, unitsUsed: units })
      .onConflictDoUpdate({
        target: [usage.organizationId, usage.periodId, usage.costClass],
        set: { unitsUsed: sql`${usage.unitsUsed} + ${units}`, updated: Date.now(), updatedBy: actor.userId },
        setWhere: sql`${usage.deleted} IS NULL`,
      });
  }

  async findForPeriod(organizationId: string, periodId: string, client: DbClient = db): Promise<UsageSelect[]> { /* … */ }
}
export const usageRepo = new UsageRepository();
```

> The `ON CONFLICT` target matches the unique index; this is what makes the increment safe under the concurrent tool calls #169 will drive (discovery Enterprise → Concurrency). The Redis hot counter (#169) stays authoritative for the *deny decision*; this table is the durable balance.

Register both in `apps/api/src/db/repositories/index.ts` and on `DbService.repository` (`db.service.ts`), following the `usersRepo`/`organizationsRepo` pattern.

### `TierService`

**File: `apps/api/src/services/tier.service.ts`** (new)

```ts
export class TierService {
  private static cache = new Map<string, { policy: TierPolicy; expires: number }>();
  private static readonly TTL_MS = 60_000;
  static readonly DEFAULT_TIER = "standard";

  /** Async + TTL-cached (D4). Unknown/blank slug → default tier, never throw (Enterprise → Failure modes). */
  static async resolveTier(org: { tier: string }): Promise<TierPolicy> {
    const slug = org.tier || TierService.DEFAULT_TIER;
    const hit = TierService.cache.get(slug);
    if (hit && hit.expires > /* injected now */ Date.now()) return hit.policy;
    let row = await DbService.repository.tiers.findBySlug(slug);
    if (!row) {
      logger.warn({ slug }, "unknown tier slug; falling back to default");
      row = await DbService.repository.tiers.findBySlug(TierService.DEFAULT_TIER);
      if (!row) throw new ApiError(ApiCode.TIER_DEFAULT_MISSING, 500); // seed guarantees it exists
    }
    const policy = TierService.tierPolicyFromRow(row);
    TierService.cache.set(slug, { policy, expires: Date.now() + TierService.TTL_MS });
    return policy;
  }

  static tierPolicyFromRow(row: TierSelect): TierPolicy { /* flat row → nested TierPolicy */ }

  /** "2026-07" for monthly/anchorDay=1; anchor-shifted otherwise. */
  static periodIdFor(period: TierPolicy["period"], at: Date): string { /* … */ }

  static invalidate(slug?: string): void { slug ? TierService.cache.delete(slug) : TierService.cache.clear(); }
}
```

`invalidate` is called after any tier write (seed/admin SQL is out of process, so the ≤60 s TTL is the backstop there).

### `UsageService`

**File: `apps/api/src/services/usage.service.ts`** (new)

```ts
export class UsageService {
  /** #169 calls this as part of its atomic charge. */
  static async increment(orgId: string, costClass: CostHint, units: number, periodId: string, actor: { userId: string }, client?: DbClient): Promise<void> {
    if (units <= 0) return;
    await DbService.repository.usage.increment(orgId, periodId, costClass, units, actor, client);
  }

  /** available = allocation − used; null allocation ⇒ available null (unlimited). */
  static async getBalance(org: { id: string; tier: string }, policy: TierPolicy, at: Date): Promise<{
    periodId: string;
    byClass: Record<CostHint, { used: number; available: number | null }>;
  }> {
    const periodId = TierService.periodIdFor(policy.period, at);
    const rows = await DbService.repository.usage.findForPeriod(org.id, periodId);
    // map each class: used = row?.unitsUsed ?? 0; alloc = policy.allocations[class].unitsPerPeriod;
    // available = alloc === null ? null : Math.max(0, alloc - used)
  }
}
```

### Read endpoint

**`GET /api/organization/usage`** (auth, org-scoped) — `organization.router.ts`

- Resolve org → `TierService.resolveTier(org)` → `UsageService.getBalance(org, policy, now)`.
- Response `200 { success, payload: { tier: TierPolicy, usage: { periodId, byClass } } }`.
- `@openapi` block references the new registered component schemas (per API style guide).

**Contract** — `packages/core/src/contracts/tier.contract.ts` (new):

```ts
export const OrganizationUsageGetResponseSchema = z.object({
  tier: TierPolicySchema,
  usage: z.object({
    periodId: z.string(),
    byClass: z.record(CostHintSchema, z.object({ used: z.number().int(), available: z.number().int().nullable() })),
  }),
});
export type OrganizationUsageGetResponse = z.infer<typeof OrganizationUsageGetResponseSchema>;
```

Re-export from `contracts/index.ts`. (The raw `tier` slug also flows on `OrganizationGetResponse` via the model change — no new mapper.)

### Settings → Organization display

**`apps/web/src/api/organizations.api.ts`** — add `usage: () => useAuthQuery<OrganizationUsageGetResponse>(queryKeys.organizations.usage(), "/api/organization/usage", …)`; register the key in `keys.ts`.

**`apps/web/src/views/Settings.view.tsx`** — the Organization tab's `<MetadataList>` gains rows fed by `sdk.organizations.usage()`:

- **Subscription Tier** — `tier` display name (from `usage.tier.tier` → a small slug→label map, or `displayName` surfaced on the policy).
- **Units used / available** — per cost class: `used` / `available` (`available === null` → "Unlimited"). Rendered as `MetadataList` rows (or a compact usage bar per class).

Before #169 is live, `used = 0` and available = full allocation — no frontend change when #169 starts writing.

### Error codes (`apps/api/src/constants/api-codes.constants.ts`)

- `TIER_DEFAULT_MISSING` — default tier row absent (should be impossible post-seed; a 500 guard).

---

## Migration

`cd apps/api && npm run db:generate -- --name add_tiers_usage_and_org_tier`, producing one migration that, in order:

1. `CREATE TABLE tiers (...)` with the **UNIQUE constraint** on `slug` + CHECKs.
2. `CREATE TABLE usage (...)` with the unique `(org, period, class)` index + CHECKs.
3. `INSERT` the default `standard` tier row (so step 4's FK is satisfiable) — hand-added to the generated SQL, values matching *Seed* below.
4. `ALTER TABLE organizations ADD COLUMN tier text NOT NULL DEFAULT 'standard' REFERENCES tiers(slug)`.

**Existing organizations are seeded with `standard` by this migration**, not left null: the `NOT NULL DEFAULT 'standard'` in step 4 backfills the `tier` value of every existing org row (Postgres applies the column default to pre-existing rows on `ADD COLUMN`), and the FK is satisfied because step 3 created the `standard` row first. So every org — pre-existing or newly created — resolves a valid tier from day one; there is no "org with no tier" state.

**Ordering is load-bearing:** the `standard` row (3) must exist before the FK-defaulted column is added (4), and `slug` must carry a non-partial UNIQUE constraint (1) for the FK to be creatable at all. Single Drizzle transaction; hand-edit the generated SQL to insert step 3 (Drizzle authors schema, not the seed row) — the same technique prior data-bearing migrations use. No production data at risk (project memory: no critical production data yet), but the backfill is correct regardless of row count.

---

## Seed

**`apps/api/src/services/seed.service.ts`** — add `seedTiers(tx)` called from `seed()` (idempotent: skip if `standard` already present). The **`standard`** row (Q1 — real, conservative, tunable by later `UPDATE`):

| field | value | note |
|---|---|---|
| `slug` / `displayName` | `standard` / `Standard` | |
| `periodKind` / `periodAnchorDay` | `monthly` / `1` | Q3 |
| `overage` | `hard-deny` | |
| free | `unitsPerPeriod = NULL`, `ratePerMin = NULL` | unlimited (free tools uncapped) |
| metered | `unitsPerPeriod = 1000`, `ratePerMin = 20` | ~1k web_search/geocode calls/mo |
| expensive | `unitsPerPeriod = 100`, `ratePerMin = 5` | |
| `perToolCaps` | `NULL` | none by default |

Numbers are a starting point, changeable with a one-line `UPDATE` (the reason for the DB table). Uses `TierModelFactory().create(SystemUtilities.id.system).update({...}).parse()` per the connector-definition seed pattern.

---

## TDD test plan

Run via project npm scripts (`feedback_use_npm_test_scripts`): `cd packages/core && npm run test:unit`; `cd apps/api && npm run test:unit && npm run test:integration`; `cd apps/web && npm run test:unit`.

### Layer 1 — `@portalai/core` models & contracts

1. `TierPolicySchema` parses a well-formed policy; rejects an unknown cost class key.
2. `AllocationSchema` accepts `null` unitsPerPeriod/ratePerMin (unlimited) and non-negative ints; rejects negatives.
3. `TierPeriodSchema` rejects `anchorDay` outside 1–28 and `kind !== "monthly"`.
4. `OverageSchema` rejects values outside `hard-deny|soft-alert`.
5. `TierSchema` (row) round-trips through `TierModelFactory().create().update(...).parse()` with audit fields populated.
6. `UsageSchema` rejects negative `unitsUsed` and an unknown `costClass`.
7. `OrganizationUsageGetResponseSchema` accepts a full payload; `available: null` is valid (unlimited).
8. `OrganizationSchema` now includes `tier` (string) and still parses a full org.

### Layer 2 — Drizzle / repositories / type-checks (integration)

9. `tiers` insert + `findBySlug` round-trip; soft-deleted rows excluded from the finder.
10. **`slug` UNIQUE constraint rejects any duplicate** — a second row with an existing slug throws, **even after the first is soft-deleted** (full, non-partial constraint; confirms slug is globally unique and thus a valid FK target).
11. `tiers_overage_check` / `tiers_anchor_day_check` / `tiers_charges_nonneg` reject violating direct inserts.
12. `usage.increment` inserts a new `(org,period,class)` row at `units`; a second call **adds** (not overwrites) — asserts atomic accumulation.
13. `usage.increment` under simulated concurrency (two awaited inserts on the same key) yields the summed total, not a lost update (ON CONFLICT path).
14. `usage` unique index rejects a duplicate live `(org,period,class)`.
15. `findForPeriod` returns only the given org+period, live rows only.
16. `organizations.tier` FK rejects an org row pointing at a nonexistent slug; defaults to `standard` when unset.
17. **Dual-schema guards compile** — `type-check` passes for `Tier`/`Usage`/`Organization` (a deliberate field-type mismatch in a scratch test fails it).

### Layer 3 — services

18. `TierService.tierPolicyFromRow` assembles the nested `TierPolicy` from a flat row (null charge → null allocation).
19. `resolveTier` returns the row's policy for a known slug; **caches** (second call within TTL issues no repo read — spy asserts one fetch).
20. `resolveTier` on an **unknown slug** falls back to `standard`, logs a warning, does **not** throw.
21. `resolveTier` throws `TIER_DEFAULT_MISSING` only if even `standard` is absent (guard).
22. `invalidate(slug)` forces a re-fetch on the next call.
23. `periodIdFor` yields the expected `"YYYY-MM"` for monthly/anchorDay=1; anchor-shifted case for a non-1 anchor.
24. `UsageService.getBalance` computes `available = allocation − used` per class; `used = 0` when no row exists; `available = null` for an unlimited class; never negative (clamped at 0).
25. `UsageService.increment` no-ops for `units <= 0`.

### Layer 4 — route integration

26. `GET /api/organization/usage` returns `{ tier, usage }` for the caller's org; `standard` policy when the org is on the default tier; `used = 0` with no usage rows.
27. After `UsageService.increment(org, "metered", 30, period)`, the endpoint reports `metered.used = 30` and `available = 970`.
28. `GET /api/organization/current` payload now includes `tier`.
29. Endpoint is auth-guarded (401 without a token).

### Layer 5 — web

30. Settings → Organization renders a Subscription Tier row (mocked `sdk.organizations.usage()` → `standard`).
31. Renders used/available per class; an unlimited class shows "Unlimited".
32. Loading + error states don't crash the tab (mocked pending/error).

### Layer 6 — migration + seed

33. Migration integration probe: after migrate, `tiers` has the `standard` row, `organizations.tier` exists, `usage` exists.
34. **Existing orgs are backfilled to `standard`** — seed an org row **before** running the migration, migrate, then assert that org's `tier === "standard"` (the `NOT NULL DEFAULT` backfill), and that `resolveTier` on it returns the `standard` policy. Guards the "no org without a tier" invariant.
35. `seedTiers` is idempotent — a second `db:seed` doesn't duplicate `standard` (relies on the `slug` UNIQUE constraint + a skip-if-present check).

**Totals:** ~8 core, ~10 api integration, ~8 service, ~4 route, ~3 web, ~3 migration/seed ≈ **36 cases**.

---

## Acceptance criteria

- [ ] All new test cases pass; existing suites green; `npm run lint && npm run type-check` clean at repo root.
- [ ] `npm run db:migrate` on a fresh DB yields `tiers` (+ seeded `standard`), `usage`, and `organizations.tier` (FK, default `standard`).
- [ ] **Every existing organization is backfilled to `standard`** by the migration (no null/unresolvable tier on any pre-existing org); `resolveTier` succeeds for all orgs post-migrate.
- [ ] **`tiers.slug` is globally unique** — a duplicate slug insert is rejected (live or soft-deleted), and the constraint is non-partial so it validly backs the `organizations.tier` FK.
- [ ] `resolveTier(org)` returns a valid `TierPolicy`; an org with no/unknown tier resolves `standard` without throwing; a second call within 60 s hits the cache.
- [ ] `UsageService.increment` accumulates atomically under concurrency; `getBalance` computes `available = allocation − used` (null = unlimited, never negative).
- [ ] `GET /api/organization/usage` returns tier + used/available; `GET /api/organization/current` includes `tier`.
- [ ] Settings → Organization shows tier + used/available per class in the dev app; unlimited renders "Unlimited".
- [ ] Changing `standard`'s `metered_units_per_period` via SQL and waiting out the TTL (or calling `invalidate`) changes the resolved allocation with **no code change**.
- [ ] `TierPolicy` + `UsageService.increment` are the only interfaces #169 needs to consume — no enforcement, counting, or deny logic ships here.

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| FK-defaulted `organizations.tier` fails because `standard` doesn't exist yet at column-add time. | Migration inserts the `standard` row (step 3) **before** the `ALTER TABLE` (step 4); integration test 33 asserts the ordering works on a fresh DB. |
| Implementer follows the repo's usual soft-delete-**partial** unique-index convention on `tiers.slug`, and the FK creation then fails (Postgres won't reference a partial-indexed column). | The table spec calls for a **full `unique()` constraint** on `slug` with an explicit comment; test 10 asserts non-partial behavior (rejects reuse even post-soft-delete). Deviation surfaces at migrate time and in that test. |
| A pre-existing org ends up with a null/unresolvable tier. | The `NOT NULL DEFAULT 'standard'` backfills every existing row at `ADD COLUMN`; test 34 seeds an org before the migration and asserts it resolves `standard` after. |
| `resolveTier` throwing would break every tool call once #169 wires it in. | Unknown slug → default fallback + warning (test 20); the only throw is the `TIER_DEFAULT_MISSING` guard, which the seed makes unreachable in practice. |
| Cache serves a stale allocation after an admin SQL `UPDATE`. | ≤60 s TTL bounds staleness; `invalidate` is the immediate path (used by any in-process write). Documented as acceptable for tier economics that change rarely. |
| Concurrent charges lose an increment. | `ON CONFLICT DO UPDATE ... SET units_used = units_used + N` is atomic in Postgres; test 13 asserts summed totals under concurrent inserts. |
| `Date.now()` in `resolveTier`/`periodIdFor` hurts testability. | Inject `now`/a clock into `TierService`/`UsageService` (as the model factories inject `dateFactory`) so tests are deterministic. |
| Building the usage table before #169 exists = infra without a caller. | The Settings display (this ticket) *is* a concrete reader of `getBalance`; #169 is the committed writer. Not speculative. |

**Rollback:** revert the migration (drop `usage`, drop `organizations.tier`, drop `tiers`) + `git revert`. Data-lossless — no production rows.

---

## Files touched

**`packages/core`** — new: `models/tier.model.ts`, `models/usage.model.ts`, `contracts/tier.contract.ts`; edit: `models/organization.model.ts` (+`tier`), `models/index.ts`, `contracts/index.ts`; new tests under `__tests__/models` + `__tests__/contracts`.

**`apps/api`** — new: `db/schema/tiers.table.ts`, `db/schema/usage.table.ts`, `db/repositories/tiers.repository.ts`, `db/repositories/usage.repository.ts`, `services/tier.service.ts`, `services/usage.service.ts`, the migration, and integration tests; edit: `db/schema/organizations.table.ts`, `db/schema/zod.ts`, `db/schema/type-checks.ts`, `db/schema/index.ts`, `db/repositories/index.ts`, `services/db.service.ts`, `services/seed.service.ts`, `routes/organization.router.ts`, `constants/api-codes.constants.ts`.

**`apps/web`** — edit: `api/organizations.api.ts`, `api/keys.ts`, `api/sdk.ts`, `views/Settings.view.tsx`; new tests for the Settings usage rows.

No new dependency. No env-var change. No infra change.

---

## Next step

`docs/SUBSCRIPTION_TIER_POLICY.plan.md` — TDD slices matching the discovery's Next-step: (1) `tiers` table + model + repo + seed + `TierPolicy` + `TierService.resolveTier` (unit + integration); (2) `organizations.tier` slug FK + `tier` on the model (auto-flows to `OrganizationGetResponse`); (3) `usage` table + model + repo + `UsageService` (increment + `getBalance`) + the read endpoint; (4) Settings → Organization display. Each slice green and independent; #169's spec unblocks once slices 1 + 3 freeze the `resolveTier` + increment contracts.
