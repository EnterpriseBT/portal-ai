# Declarative tier catalog + `portalops tier apply` — Discovery

**Issue:** [EnterpriseBT/portal-ai#218](https://github.com/EnterpriseBT/portal-ai/issues/218) · Epic #177 · Branch `feat/tier-catalog` → `epic/subscription-billing`

**Why this exists.** Every environment runs its own Stripe account, so `tiers.stripe_price_id` is inherently env-local — tier rows can't be copied between environments and no code-side seed can know the price ids. Meanwhile tier *policy* (allocations, #214 entitlements, `selectable`) has two writers: seed constants that converge some fields on every boot, and operator SQL that seed can silently fight (#214 discovery OQ1). This is the versioned catalog + idempotent applier that makes tier **policy** declared once in the repo and applied per environment, with Stripe `lookup_key` as the cross-environment price identity that apply *resolves* (never creates) — the record-of-truth split that dissolves the two-writer problem: **policy lives in git, pricing lives in Stripe**, and apply is the join.

## The current shape

### Tiers table + policy model

| Piece | Location | Note |
|---|---|---|
| `tiers` table | `apps/api/src/db/schema/tiers.table.ts:23-83` | `slug` (unique, FK target of `organizations.tier`), `displayName`, `periodKind/AnchorDay`, `overage`, six-cell nullable charge grid, JSONB `perToolCaps`, `stripePriceId` (nullable, unique-where-not-null `:45-66`), `selectable`, #214 `builtinToolpacks` (jsonb `string[]`, default `[]` fail-closed) + `customToolpacks` (bool) `:49-56` |
| `TierSchema` / `TierPolicySchema` | `packages/core/src/models/tier.model.ts:91-118`, `:71-84` | flat DB row vs assembled policy; `TierEntitlementsSchema:60-64` |
| Repository | `apps/api/src/db/repositories/tiers.repository.ts:24,37,47-53` | `findBySlug`, `findSelectable`, `priceIndex()` (`stripe_price_id → slug` Map). **No lookup_key finder exists.** |

### Seed — today's de-facto catalog, and the two-writer conflict

`seed.service.ts:331-384`: the doc comment (`:313-330`) already names #218 as the intended record of truth. Today **seed-authoritative** fields (`selectable`, `stripePriceId`) are healed every run (`:339-350`); **operator-authoritative** fields (`builtinToolpacks`, `customToolpacks`) are INSERT-only (`:377-378` — the #214 interim posture). `warnOnUnlistedRegistrySlugs` (`:398-406`) warns when registry packs aren't listed by any tier. `db:seed` runs on `predev`; `db:seed:ci` on deploy.

### The applier's home: `portalops` + `cli-env`

| Piece | Location | Note |
|---|---|---|
| Apply-to-env precedent | `packages/devops-cli/src/catalog.ts:40-60`, `commands/vars.ts:236-256` | typed entry array + `vars apply`: validate-all-then-write, guard once, audit per key — the exact workflow shape for `tier apply`. **No Stripe key in the config catalog today.** |
| Env registry | `packages/cli-env/src/registry.ts:44-58` | `local` has `aws: null`; `app-dev` region+envName; prod pending |
| Secrets seam | `cli-env/src/aws.ts:78-185`, `connection.ts:48-101` | `getSecret`/`putSecret` over `portalai/${envName}/…`; per-env DATABASE_URL resolved the same way (local reads `process.env.DATABASE_URL`) |
| Audit + mutation session | `cli-env` `recordAudit`; `admin-cli/src/commands/common.ts:42-63` shows the `beginMutation → mutate → audit` shape both CLIs share via cli-env | |
| Tier-mutation precedent | `packages/admin-cli/src/commands/org.ts:42-56` (`org set-tier`) | stays in portalai — it assigns a tier to a *customer org* (app data); `tier apply` manages the *tier definitions* (business config) in portalops |

### Stripe usage today

`stripe.service.ts` is the only `stripe` importer (`:10`): lazy client from `environment.STRIPE_SECRET_KEY`, pinned API version (`:21,52-62`). `createCheckoutSession` (`:108-127`) takes the tier row's `stripePriceId`; the webhook resolves **price id → slug** via `tiersRepo.priceIndex()` (`billing.service.ts:76,89,149`). `getPrice` (`:155-192`) has a 60s cache and degrades to null. **No `lookup_key` usage anywhere** — the resolve call is new surface. `GET /api/billing/tiers` (`billing.router.ts:79-102` → `billing.service.ts:235-248`) maps `findSelectable()` rows to `{slug, displayName, allocations, purchasable, price}`.

### Catalog-file precedents

(a) `packages/core/src/registries/builtin-toolpacks.ts` — frozen TS module + Zod slug schema, the cross-package source of truth read by API and web; (b) `devops-cli/src/catalog.ts` — flat typed entry array applied per env; (c) the seed constants themselves (`seed.service.ts:355-379`).

## The design space

### Decision 1 — catalog format & location

- **A. TS module in `packages/core/src/registries/tier-catalog.ts`** — a frozen, Zod-validated array like `builtin-toolpacks.ts`. Entitlements type-check against `BuiltinToolpackSlugSchema` at compile time; both consumers (seed in `apps/api`, applier in `devops-cli`) can depend on core (api already does; devops-cli gains the dep).
- **B. Standalone JSON/YAML file** — data-only, schema-validated at apply time; editable without a TS toolchain, but no compile-time slug safety and awkward for seed to consume.
- **C. TS module inside `devops-cli`** — closest to the applier, but seed can't import it and the two-writer problem returns.

| | A: core registry | B: JSON/YAML | C: devops-cli module |
|---|---|---|---|
| Compile-time slug/shape safety | ✅ (Zod + TS against the pack registry) | ❌ apply-time only | ✅ |
| Readable by seed (bootstrap) | ✅ | ⚠️ path plumbing | ❌ |
| Precedent | `builtin-toolpacks.ts` | none in-repo | `catalog.ts` (but not shared) |

**Lean: A.** The catalog is exactly what `packages/core/src/registries/` exists for; compile-time validation of entitlement slugs kills a whole class of bad-apply, and seed reads the same module so there is literally one source. devops-cli adding a `@portalai/core` dep is the only cost.

### Decision 2 — who owns `apply` *(decided at review)*

**Decided: `portalops tier apply`.** The CLI boundary is by *what the data is*: `portalai` manages customer application config/data (orgs, users, members — `org set-tier` stays there, it assigns a tier to a customer org); `portalops` owns infra, devops, and **business configuration** — tier definitions and subscription-pricing linkage are business config. This also keeps admin-cli genuinely infra-free (no `stripe`, no aws): portalops already carries the AWS seam and the `vars apply` workflow shape, and the `stripe` dep lands there. The per-env Stripe key resolves via cli-env `getSecret("stripe-secret-key")` (new `portalops` config-catalog entry) with a `STRIPE_SECRET_KEY` env-var path for `local` (`aws: null`). Security note (stripe-best-practices `references/security.md:20,40`): the secret stays in Secrets Manager; a **restricted key** (`rk_`, prices read) is the recommended key type for apply — read-only suffices since apply never creates prices.

### Decision 3 — apply semantics: resolve-only, converge-declared, diff-first *(reshaped at review)*

**Pricing lives in Stripe; the catalog carries no amounts.** A catalog entry is pure policy — displayName, period, allocation grid, overage, `selectable`, entitlements — plus `stripeLookupKey: string | null` (null = not purchasable). Price creation, amount changes, and rotation happen **in Stripe** (dashboard or Stripe CLI; rotation moves the key with `transfer_lookup_key`), where pricing is already audited. Apply's Stripe phase is a **read**: resolve each non-null lookup key via `prices.list({ lookup_keys })` to the env-local price id.

- **Resolve failure fails closed:** a declared non-null `stripeLookupKey` with no matching price in the env's account aborts the apply (before any DB write) with a message naming the runbook step ("create a price with lookup key `<k>` in this env's Stripe"). No `--allow-missing` escape: purchasable-by-catalog requires the price to exist.
- **DB phase (one transaction):** upsert-by-slug for **declared slugs only**, converging every catalog-owned field + the resolved `stripePriceId`. Rows the catalog doesn't name are never read, written, or deleted; the diff lists them once as `unmanaged`.
- **`--dry-run`:** computes both phases' would-be outcomes (`{slug: {field: {from, to}}}` + resolved/missing lookup keys) with zero writes; the same diff is printed and audited on a real apply.
- **Ordering rationale:** validate-all-then-write (the `vars apply` shape) — resolution and validation complete for the whole catalog before the first row write.

**Price-change runbook (replaces in-code rotation):** operator creates the new price in Stripe carrying the lookup key (`stripe prices create … --lookup-key <k> --transfer-lookup-key`), then runs `portalops tier apply --env <e>` — the row re-resolves to the new id. Existing subscriptions stay on the old price (Stripe semantics).

### Decision 4 — seed demotion

**Lean:** `seedTiers` keeps exactly one job — INSERT `standard` when absent (the FK bootstrap), sourcing its values **from the core catalog module** (one source, zero drift; `stripePriceId` seeded null — only apply, which can see the env's Stripe, ever writes it) — and drops *all* convergence: the seed-authoritative healing of `selectable`/`stripePriceId` (`:339-350`) is deleted, and the #214 INSERT-only entitlements posture is superseded. `warnOnUnlistedRegistrySlugs` stays.

## Tradeoff comparison

| | D1: core registry | D2: portalops + secret | D3: resolve-only apply | D4: bootstrap-only seed |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |

## Recommendation

1. `packages/core/src/registries/tier-catalog.ts`: Zod-validated frozen catalog (`TierCatalogEntrySchema` — policy fields + `stripeLookupKey`, **no price amounts**), entries = today's row values verbatim.
2. `portalops tier apply --env <e> [--dry-run] [--json] [--yes] [--confirm-prod]` in `packages/devops-cli`: guard → resolve all lookup keys (read-only Stripe) → converge declared rows in one tx → audit per changed slug (the `vars apply` shape).
3. Stripe access: `stripe` dep in devops-cli; per-env key via cli-env `getSecret("stripe-secret-key")` (+ new config-catalog entry), `process.env.STRIPE_SECRET_KEY` for `local`; document the `rk_` restricted-key recommendation (prices read).
4. Missing price for a declared lookup key = abort before any write, with the create-in-Stripe runbook message.
5. Undeclared rows: invisible to apply; diff lists them as `unmanaged`.
6. `seedTiers` → bootstrap-only INSERT of `standard` from the catalog module; all convergence removed.
7. Price changes are a Stripe-side runbook (new price + `transfer_lookup_key`) followed by an apply — never code.

## Open questions

1. **Does apply need `--only <slug>`?** Partial applies weaken "the catalog is the truth". Lean: no — the diff already scopes what changes.
2. **Webhook resolution after a price rotation** — existing subscriptions keep the *old* price id, but `priceIndex` maps only current `tiers.stripe_price_id` (`billing.service.ts:76,89`); a renewal event for an old-price subscription resolves no slug. With rotation now a rare, manual, Stripe-side runbook act, the fix is proportionate to that: Lean — **no schema**; the runbook's post-rotation step is checking for in-flight subscriptions on the old price (`stripe subscriptions list --price <old>`), and the webhook's unresolved-price handling gets a log-and-skip assertion in the spec (it must not 500). A durable price-history mapping is deferred until rotation is a real recurring event.
3. **Local-env plumbing** — `resolveEnvConnection("local")` reads `process.env.DATABASE_URL`; apply on local runs as `DATABASE_URL=… STRIPE_SECRET_KEY=… portalops tier apply --env local` (matches existing portalops-local behavior). Lean: document, don't special-case.
4. **Catalog snapshot contents** — start as a faithful snapshot of today's `standard` row (the only row), `stripeLookupKey: "standard"` if/when a price exists. Lean: snapshot verbatim; product edits come later as catalog PRs.

## Enterprise-scale considerations

- **Concurrency & correctness** — apply is operator-run and rare; the Stripe phase is read-only; the DB phase is a single transaction of upserts-by-slug. Idempotent by construction; two racing applies converge to the same state. Lean: no locking needed.
- **Accuracy & auditability** — the split *is* the design: policy audited by git + the cli-env audit trail (per-slug diff records); pricing audited by Stripe. Lean: audit the diff, not just "apply ran".
- **Failure modes** — fail-closed everywhere: unresolved lookup key, Stripe unreachable, or DB error → no partial writes (validate-all-then-write + one tx). Worst case is a stale `stripe_price_id` until the next successful apply — checkout keeps working on the old price. Lean: stated contract.
- **Scale & unbounded growth** — tier count is single-digit; one Stripe list call per purchasable tier. N/A beyond that.
- **Multi-tenancy** — tiers are env-global; org-level bespoke deals are exactly the undeclared rows apply never touches. Lean: covered by converge-declared-only.
- **Contract stability** — catalog schema is additive (new policy fields = optional schema fields + converge logic); resolve-only Stripe surface means Stripe product modeling can evolve without touching apply. Lean: covered.
- **Data lifecycle** — apply never deletes; removing a catalog entry orphans (not removes) the row, surfaced as `unmanaged`. Retiring a tier for sale = `selectable: false` in the catalog. Lean: stated contract.

## What this doesn't decide

- **Admin UI** for tier editing — the catalog + CLI is the operator surface (issue's out-of-scope).
- **Catalog contents** beyond a faithful snapshot of today's rows — product decisions land as catalog PRs later.
- **#214's enforcement mechanism** — sibling; this provisions the data it enforces.
- **Multi-currency / multi-interval matrices** — one lookup key per tier until needed.
- **Price-history schema for webhook resolution of rotated prices** — deferred until rotation is a recurring event (OQ2); the spec pins only that an unresolved price must degrade gracefully.
- **Prod environment registry entry** — `cli-env` registry marks prod pending; apply works there the day the entry lands, no code change.

## Next step

`docs/TIER_CATALOG.spec.md` (catalog schema, `portalops tier apply` contract incl. diff/dry-run shapes, resolve-failure semantics, seed demotion, the rotation runbook) and `docs/TIER_CATALOG.plan.md` — likely 4 slices: (1) catalog module + schema in core (inert); (2) Stripe lookup-key resolution seam in devops-cli (mockable, read-only); (3) `tier apply` command (dry-run, diff, DB phase, audit); (4) seed demotion + runbook/ops docs + webhook graceful-degradation pin.
