# Declarative tier catalog + `portalops tier apply` — Plan

**TDD-sequenced implementation of the #218 contract: the policy-only catalog registry in core, the resolve-only apply command in portalops (dry-run/diff, converge-declared, fail-closed), the seed demotion, and the Stripe-side runbook.**

Spec: `docs/TIER_CATALOG.spec.md`. Discovery: `docs/TIER_CATALOG.discovery.md`. Issue: #218 (epic #177). Builds on #172's tiers table/model, #214's entitlement columns, #176's `stripe_price_id` + webhook derivation, and the portalops `vars apply` workflow shape (#192).

Four slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/tier-catalog`** (PR base: `epic/subscription-billing`) — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd packages/devops-cli && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale:

- **Slice 1** freezes the data (catalog module + schema) — inert; nothing imports it yet, so the repo stays green while the single source of truth lands. Both later consumers (apply, seed) read it.
- **Slice 2** lands the two external seams (Stripe key resolution, price resolver) as pure, injectable functions — no command yet, so testable in isolation with mocks.
- **Slice 3** is the value core: `tierApply` + bin wiring, consuming slices 1–2 only.
- **Slice 4** is the demotion + pins + docs: seed reads the slice-1 module; webhook pin and doc-sync close the ticket's blast radius.

---

## Slice 1 — core: the catalog registry

The single source of truth, inert until consumed.

**Files**

- New: `packages/core/src/registries/tier-catalog.ts` — `TierCatalogEntrySchema`, `TIER_CATALOG` (one `standard` entry, values verbatim from `seed.service.ts:355-379`, `stripeLookupKey: null`), `TIER_CATALOG_BY_SLUG` (spec → Core registry).
- New: `packages/core/src/__tests__/registries/tier-catalog.test.ts`.
- Edit: the registries barrel (beside `builtin-toolpacks`) so `@portalai/core` consumers can import it.

**Steps**

1. **Tests (spec cases 1–2).** Catalog parses; slugs unique; `standard` matches the seed snapshot exactly; every catalog field name (minus `stripeLookupKey`) exists on `TierSchema`. Run; fail.
2. **Implement** the schema + frozen entry + barrel export. Green.
3. Lint + type-check; **rebuild core dist** (downstream packages consume `dist/`).

**Done when:** cases 1–2 pass; nothing else imports the module yet.

**Risk:** none — additive.

---

## Slice 2 — portalops: Stripe seams + config-catalog entry

The two injectable externals, no command yet.

**Files**

- New: `packages/devops-cli/src/stripe.ts` — `resolveStripeKey(def)` (env-var path for `aws: null`, `getSecret` otherwise) + `PriceResolver` type + `stripePriceResolver` (official SDK, pinned API version) + `TierApplyMissingPricesError` (spec → Stripe key resolution / Price resolution seam).
- Edit: `packages/devops-cli/src/catalog.ts` — `+ secret("STRIPE_SECRET_KEY", "stripe-secret-key")`.
- Edit: `packages/devops-cli/package.json` — `+ stripe`.
- New tests in `packages/devops-cli/src/__tests__/tier.test.ts` (started here, extended in slice 3).

**Steps**

1. **Tests (spec case 8 + catalog pin).** `resolveStripeKey`: local reads `process.env.STRIPE_SECRET_KEY`, local-unset → `EnvNotConfiguredError`, aws path delegates to `getSecret` (mocked). `lookupKey("STRIPE_SECRET_KEY")` resolves to the secret entry (vars surface picks it up for free). Run; fail.
2. **Implement** `stripe.ts` + the catalog line. Green.
3. Lint + type-check.

**Done when:** case 8 + the catalog pin pass; `portalops vars describe` lists the new key (by construction — the existing vars tests cover the table-driven surface).

**Risk:** the `stripe` SDK's ESM/CJS interop under the devops-cli jest config — budget a few minutes; the resolver is injectable so tests never construct a real client.

---

## Slice 3 — portalops: `tier apply` (the value core)

Diff, dry-run, fail-closed resolution, one-tx convergence, per-slug audit, bin wiring.

**Files**

- New: `packages/devops-cli/src/commands/tier.ts` — `tierApply(def, opts, deps?)`, `TierApplyResult`/`TierChange` shapes (spec → `tier apply`).
- New: `packages/devops-cli/src/tables.ts` — full `tiers` Drizzle def (header names `apps/api/src/db/schema/tiers.table.ts` as source of truth).
- Edit: `packages/devops-cli/src/bin.ts` — `tier` group + `apply` leaf (`common()` flags + `--dry-run`); human render + `--json` passthrough.
- Edit: `packages/devops-cli/package.json` — `+ postgres`, `+ drizzle-orm`, `+ @portalai/core`.
- Edit/extend: `src/__tests__/tier.test.ts` (cases 3–7).

**Steps**

1. **Tests (spec cases 3–7).** Dry-run diff (insert/update/noop + `unmanaged`), no guard/writes/audit on dry-run; missing lookup key → typed error before any DB contact; field-level convergence incl. `stripeLookupKey: null` → price nulled; undeclared row untouched; real run: guard once, audit per changed slug, `createdBy: "portalops"` on inserts. All with injected `resolvePrices` + a fake DB seam. Run; fail.
2. **Implement** `tierApply` (validate-all-then-write per `vars.ts:236-256`) + `tables.ts` + bin wiring. Green.
3. Lint + type-check.

**Done when:** cases 3–7 pass; `portalops tier apply --env local --dry-run` runs against the dev stack (manual spot-check — remember `npx` runs `dist/`, rebuild first per `project_npx_uses_stale_dist`).

**Risk:** the injected-DB seam's shape — keep `deps.connect` returning the same drizzle-ish handle the real path builds from `resolveEnvConnection(def).db()`, so tests exercise the exact query builder calls. Budget slice time here; it's the only genuinely new plumbing.

---

## Slice 4 — seed demotion, webhook pin, runbook, doc-sync

Closes the two-writer problem and the documentation blast radius.

**Files**

- Edit: `apps/api/src/services/seed.service.ts:331-384` — bootstrap-only `seedTiers` sourced from `TIER_CATALOG_BY_SLUG`; convergence block deleted; doc comment rewritten (spec → Seed demotion).
- Edit: seed test coverage (cases 9–10) + billing webhook unit (case 11 — rotation-named unmapped-price pin).
- Edit: `packages/devops-cli/COMMANDS.md` — the `tier` section + runbook (create/rotate prices Stripe-side, fresh-env bootstrap, `rk_` recommendation, local invocation).
- Edit: `CLAUDE.md` package-table row for `@portalai/devops-cli` (+ its mirror `.github/copilot-instructions.md`) — the CLI's described capability set grows `tier apply`.

**Steps**

1. **Tests (cases 9–11).** Existing-row drift → no write (inverts the old convergence assertion); fresh-DB INSERT equals the catalog entry; rotation pin on `deriveTierFromSubscription`. Run; fail (9 fails against current convergence code).
2. **Implement** the demotion + comment rewrite. Green.
3. **Doc-sync sweep.** COMMANDS.md runbook; CLAUDE.md + copilot mirror row; confirm no Help-surface/glossary exposure (operator-only feature — none).
4. Lint + type-check; full per-package suites.

**Done when:** cases 9–11 pass; every pre-existing suite green (the seed-behavior inversion is the regression risk — the old convergence tests must be *updated*, not deleted-and-forgotten).

**Risk:** hidden dependents of the healed-on-boot behavior (anything assuming `selectable` self-repairs). The integration suite re-runs seed constantly — a green full run is the guard.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Core catalog module (inert single source) | cases 1–2 |
| 2 | Stripe key + price-resolver seams, config-catalog entry | case 8 + catalog pin |
| 3 | `tier apply` command + bin wiring | cases 3–7 |
| 4 | Seed demotion + webhook pin + runbook + doc-sync | cases 9–11 |

## Cross-slice notes

- **Core dist rebuild** after slice 1, before slice 3's devops-cli type-check (`@portalai/core` consumed from `dist/`).
- **`npx portalops` runs `dist/`** (`project_npx_uses_stale_dist`) — rebuild devops-cli before any manual/live check in slices 3–4.
- **devops-cli dependency growth** (`stripe`, `postgres`, `drizzle-orm`, `@portalai/core`) is deliberate and confirmed at spec review — don't "optimize" it away mid-implementation.
- **Doc-sync inventory**: `COMMANDS.md` (slice 4), `CLAUDE.md` package table + copilot mirror (slice 4). No tool/prompt/Help surfaces — operator-only.
- **Live smoke prerequisites** (for `/smoke 218` later): a Stripe test-mode account with a price carrying a lookup key, `STRIPE_SECRET_KEY` in the local env, and a scratch ad-hoc tier row to prove `unmanaged` immunity.

## Next step

Implementation starts on this branch — slice 1, tests-first, one commit per slice — once you've confirmed discovery, spec, and this plan.
