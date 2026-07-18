# Declarative tier catalog + `portalops tier apply` — Spec

**Issue:** [#218](https://github.com/EnterpriseBT/portal-ai/issues/218) · Epic #177 · Discovery: `docs/TIER_CATALOG.discovery.md` · Branch `feat/tier-catalog` → `epic/subscription-billing`

Pins the policy-only tier catalog in core, the resolve-only `portalops tier apply` command (dry-run/diff, converge-declared, fail-closed on missing prices), the seed demotion to bootstrap-only, and the Stripe-side price runbook. **Policy lives in git; pricing lives in Stripe; apply is the join.**

## Key decisions (flag for review)

1. **D1** — catalog is a Zod-validated frozen TS registry in `packages/core/src/registries/tier-catalog.ts`; entries carry policy + `stripeLookupKey` only, **never price amounts** (review decision 2026-07-18).
2. **D2** — `portalops` owns apply (business config); admin-cli stays infra-free. Stripe key per env via cli-env `getSecret`, env-var path for `local`.
3. **D3** — apply's Stripe phase is **read-only** (`prices.list({ lookup_keys })`); a declared key with no price aborts before any DB write. Price creation/rotation is a Stripe-side runbook.
4. **D4** — `seedTiers` demotes to bootstrap-INSERT of `standard` sourced from the catalog module; all convergence (incl. the #176 seed-authoritative healing at `seed.service.ts:339-350`) is deleted.
5. **Webhook posture unchanged**: `deriveTierFromSubscription` already warn-and-keeps on an unmapped price (`billing.service.ts:89-96`) — this spec *pins* that as the rotated-price degradation and adds no schema.

## Scope

### In scope

1. `TierCatalogEntrySchema` + `TIER_CATALOG` registry (core), snapshotting today's `standard` row.
2. `portalops tier apply --env <e> [--dry-run] [--json] [--yes] [--confirm-prod]`: lookup-key resolution, declared-row convergence in one tx, diff output, per-slug audit.
3. `STRIPE_SECRET_KEY` entry in the portalops config catalog; per-env key resolution helper.
4. Seed demotion + catalog-sourced bootstrap.
5. Runbook (price create/rotate, fresh-env bootstrap) in `packages/devops-cli/COMMANDS.md`.

### Out of scope

Admin UI; catalog content changes beyond the snapshot; #214 enforcement; multi-currency/interval; price-history schema (deferred until rotation recurs); prod registry entry.

## Surface

### Core registry (`packages/core/src/registries/tier-catalog.ts`, new)

```ts
export const TierCatalogEntrySchema = z.object({
  slug: z.string().min(1),
  displayName: z.string().min(1),
  periodKind: z.literal("monthly"),          // widen when a second kind exists
  periodAnchorDay: z.number().int().min(1).max(28),
  overage: z.literal("hard-deny"),
  freeUnitsPerPeriod: z.number().int().nullable(),
  freeRatePerMin: z.number().int().nullable(),
  meteredUnitsPerPeriod: z.number().int().nullable(),
  meteredRatePerMin: z.number().int().nullable(),
  expensiveUnitsPerPeriod: z.number().int().nullable(),
  expensiveRatePerMin: z.number().int().nullable(),
  perToolCaps: PerToolCapsSchema.nullable(), // reuse tier.model's shape
  selectable: z.boolean(),
  builtinToolpacks: z.array(BuiltinToolpackSlugSchema), // compile+parse-time slug safety
  customToolpacks: z.boolean(),
  /** Stripe lookup_key (cross-env price identity). null = not purchasable. */
  stripeLookupKey: z.string().nullable(),
});
export type TierCatalogEntry = z.infer<typeof TierCatalogEntrySchema>;
export const TIER_CATALOG: readonly TierCatalogEntry[]; // frozen; parsed at module load
export const TIER_CATALOG_BY_SLUG: ReadonlyMap<string, TierCatalogEntry>;
```

Initial content: one entry — `standard`, values verbatim from `seed.service.ts:355-379` (`stripeLookupKey: null`; it isn't purchasable today). Exported from the same registries barrel as `builtin-toolpacks`. Field names deliberately mirror `TierSchema` (`tier.model.ts:91-118`) so convergence is a flat field map; a core unit test asserts every catalog field name exists on `TierSchema`.

### Stripe key resolution (`packages/cli-env`)

- `packages/devops-cli/src/catalog.ts:41-49`: `+ secret("STRIPE_SECRET_KEY", "stripe-secret-key")` — `vars describe/list/get/set/apply/template` pick it up with zero further code.
- New helper `resolveStripeKey(def: EnvironmentDefinition): Promise<string>` in `packages/devops-cli/src/stripe.ts`: `def.aws === null` → `process.env.STRIPE_SECRET_KEY` (typed `EnvNotConfiguredError` when unset, mirroring `connection.ts:71-79`); else `getSecret(def, "stripe-secret-key")`. Runbook documents the `rk_` restricted-key recommendation (prices read).

### Price resolution seam (`packages/devops-cli/src/stripe.ts`, new)

```ts
/** Resolve lookup keys → env-local price ids. Read-only. Injectable for tests. */
export type PriceResolver = (
  stripeKey: string,
  lookupKeys: string[]
) => Promise<Map<string, string>>; // lookupKey → priceId

export const stripePriceResolver: PriceResolver; // official `stripe` SDK, pinned STRIPE_API_VERSION (mirror stripe.service.ts:21)
```

Implementation: `stripe.prices.list({ lookup_keys, active: true, limit: 100 })`. Any declared key absent from the result → collected into `TierApplyMissingPricesError` (typed, lists keys + the runbook one-liner). New `stripe` dependency in `packages/devops-cli/package.json`.

### `tier apply` (`packages/devops-cli/src/commands/tier.ts`, new)

```ts
export interface TierFieldChange { from: unknown; to: unknown }
export interface TierChange {
  slug: string;
  action: "insert" | "update" | "noop";
  fields: Record<string, TierFieldChange>;    // empty for noop
  stripePriceId: string | null;               // resolved (null = not purchasable)
}
export interface TierApplyResult {
  dryRun: boolean;
  changes: TierChange[];                      // one per declared slug
  unmanaged: string[];                        // live tier slugs the catalog doesn't name
}

export async function tierApply(
  def: EnvironmentDefinition,
  opts: MutateOptions & { dryRun?: boolean },
  deps?: { resolvePrices?: PriceResolver; connect?: DbFactory }
): Promise<TierApplyResult>
```

Semantics (validate-all-then-write, the `vars apply` shape at `commands/vars.ts:236-256`):

1. Parse `TIER_CATALOG` (already parsed at import; belt-and-braces re-validate).
2. Resolve the Stripe key + all non-null lookup keys. **Missing key(s) → throw before any DB contact.**
3. Read live `tiers` rows; compute per-slug diff (catalog-owned fields + resolved `stripePriceId`; `stripeLookupKey: null` converges `stripe_price_id` to `NULL`). Rows not in the catalog → `unmanaged`, never read further, never written, never deleted.
4. `--dry-run`: return the result now — **no guard, no writes, no audit** (read-only).
5. Real run: `guardMutation(def, opts)` once (`--yes` at staging+, `--confirm-prod` at prod — existing semantics), then one transaction: UPDATE changed rows / INSERT absent ones (`created/createdBy` stamped `portalops`, mirroring `vars apply`'s `operator: "portalops"`), then `recordAudit` **per changed slug**: `{ env, operator: "portalops", command: "tier apply", args: { slug, action, fields: <changed names>, stripePriceId } }`.
6. DB access: new `postgres` + `drizzle-orm` deps and a local `src/tables.ts` with the **full** `tiers` column set (admin-cli's `tables.ts:50-54` slug-subset precedent, widened; header comment names `apps/api/src/db/schema/tiers.table.ts` as source of truth). Connection string via `resolveEnvConnection(def.name).db()`.

`bin.ts`: new `tier` command group; `tier apply` leaf with the shared `common()` flags (`--env`, `--json`, `--yes`, `--confirm-prod`) + `--dry-run`. `--json` emits `TierApplyResult` verbatim; human render prints a per-slug field table + `unmanaged` + `dry run — nothing written` footer.

### Seed demotion (`apps/api/src/services/seed.service.ts:331-384`)

`seedTiers` becomes bootstrap-only:

- Row exists → **no writes at all** (the `:339-350` seed-authoritative convergence block is deleted); still calls `warnOnUnlistedRegistrySlugs`.
- Row absent → INSERT `standard` via `TierModelFactory` **sourced from `TIER_CATALOG_BY_SLUG.get("standard")`** (drop the inline constants at `:355-379`), `stripePriceId: null` (only apply, which can see the env's Stripe, ever writes it).
- Doc comment rewritten: the two-convergence-classes taxonomy is replaced by "catalog-owned via `portalops tier apply` (#218); seed bootstraps `standard` only".

### Webhook degradation pin (no code change)

`BillingService.deriveTierFromSubscription` (`billing.service.ts:70-99`) already maps unmapped-price → warn + keep `currentTier`. One new unit case names the rotation scenario explicitly so the behavior can't regress silently.

### Runbook (`packages/devops-cli/COMMANDS.md`)

New `tier` section: apply/dry-run usage; fresh-env bootstrap (create price with lookup key in Stripe → apply); price change (`stripe prices create … -d "lookup_key=<k>" -d "transfer_lookup_key=true"` → apply → check in-flight subs on the old price with `stripe subscriptions list --price <old>`); the `rk_` key recommendation; `local` invocation (`DATABASE_URL=… STRIPE_SECRET_KEY=… portalops tier apply --env local`).

## Migration

**None** — no schema change. (`stripe_price_id`, entitlements, and all policy columns already exist.)

## Seed

Changed as specified above; no new seed content. Ordering unaffected (`seedTiers` still runs inside `SeedService.seed()`'s transaction, `seed.service.ts:295-311`).

## TDD test plan

### Layer 1 — core (`packages/core`, `src/__tests__/registries/tier-catalog.test.ts`, new)

1. `TIER_CATALOG` parses against `TierCatalogEntrySchema`; slugs unique; `standard` present with the exact `seed.service.ts` snapshot values.
2. Every catalog field name (minus `stripeLookupKey`) exists on `TierSchema` (the flat-map convergence guarantee).

### Layer 2 — devops-cli (`packages/devops-cli/src/__tests__/tier.test.ts`, new; `npm run test:unit`)

3. Dry-run: computes insert/update/noop diffs + `unmanaged` from injected rows; **no** guard, sql-exec, or audit calls (spies).
4. Missing lookup key: resolver returns a partial map → `TierApplyMissingPricesError` listing keys; no DB factory invocation.
5. Convergence: field-level diff correctness (entitlements array change, `selectable` flip, `stripePriceId` adoption, `stripeLookupKey: null` → price id nulled); noop rows produce `action: "noop"` and no audit.
6. Undeclared row untouched: present in `unmanaged`, absent from writes.
7. Real run: guard invoked once; one audit record per **changed** slug with `{command: "tier apply"}`; insert stamps `createdBy: "portalops"`.
8. `resolveStripeKey`: local + env var; local without var → `EnvNotConfiguredError`; aws path delegates to `getSecret` (mocked).

### Layer 3 — api (`apps/api`, existing seed coverage extended)

9. `seedTiers` on an existing row with drifted `selectable`/`stripePriceId` → **no write** (inverts the old convergence assertion).
10. `seedTiers` on empty DB → `standard` row equals the catalog entry (spot-check entitlements + grid).
11. `deriveTierFromSubscription` rotation pin: live sub with a price id absent from `priceIndex` → keeps `currentTier`, `subscriptionLive: true` (extends the existing unmapped-price case with the rotation name).

**Totals ≈ 11 cases** (2 core, 6 devops-cli, 3 api). Per-package: `cd packages/core && npm run test:unit`; `cd packages/devops-cli && npm run test:unit`; `cd apps/api && npm run test:unit && npm run test:integration`. No migration test (no migration).

## Acceptance criteria

- [ ] Editing the catalog + `portalops tier apply --env <e>` changes exactly that env's declared rows; `--dry-run` prints the same diff with zero writes.
- [ ] Apply twice → second run all-noop (idempotent), including zero audit records.
- [ ] Declared lookup key with no price in the env's Stripe → apply aborts pre-DB naming the key(s) + runbook step; no partial writes.
- [ ] An ad-hoc tier row not in the catalog survives applies untouched and is listed `unmanaged`.
- [ ] After a Stripe-side rotation (`transfer_lookup_key`), one apply re-points `stripe_price_id`; existing subscriptions unaffected; webhook warn-and-keeps on the old price id.
- [ ] `db:seed` after an apply changes nothing (bootstrap-only); fresh DB still gets `standard`.
- [ ] `STRIPE_SECRET_KEY` manageable via `portalops vars` like any catalog key.
- [ ] Root lint + type-check green; all suites green.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Apply misconverges a live env's tier policy | Fail-closed ordering (resolve → validate → one tx); `--dry-run` is the review gate; per-slug audit + git history reconstruct any change. Rollback = `git revert` the catalog edit + re-apply. |
| Seed demotion regresses pre-#176 DBs expecting `selectable` healing | One-time concern: every live env has already been healed by the current seed; the bootstrap INSERT still sets `selectable: true` for fresh DBs. |
| devops-cli's local `tiers` table def drifts from the api schema | Core test (case 2) pins catalog↔`TierSchema`; the table def header names its source; a drifted column fails apply loudly (SQL error), never silently. |
| Rotated price id unmapped in webhook | Pre-existing warn-and-keep behavior, now pinned by test (case 11); runbook's post-rotation check covers in-flight subs. Fail direction: org keeps its current tier — never a downgrade surprise. |

## Files touched

**`packages/core`** — new: `src/registries/tier-catalog.ts`, `src/__tests__/registries/tier-catalog.test.ts`; edit: registries barrel export.

**`packages/devops-cli`** — new: `src/stripe.ts`, `src/commands/tier.ts`, `src/tables.ts` (or widen if created by then), `src/__tests__/tier.test.ts`; edit: `src/catalog.ts` (+`STRIPE_SECRET_KEY`), `src/bin.ts` (tier group), `package.json` (+`stripe`, `postgres`, `drizzle-orm`, `@portalai/core`), `COMMANDS.md` (runbook).

**`apps/api`** — edit: `src/services/seed.service.ts` (demotion + catalog import); seed + billing test extensions.

## Next step

`docs/TIER_CATALOG.plan.md` — 4 slices: (1) core catalog module + tests (inert); (2) devops-cli seams — `resolveStripeKey`, `PriceResolver`, config-catalog entry (mockable, no command yet); (3) `tier apply` command + bin wiring + tests (the value core); (4) seed demotion + webhook pin + runbook + doc-sync sweep. Each slice a testable commit on this branch.
