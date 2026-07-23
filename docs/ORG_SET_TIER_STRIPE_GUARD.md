# `org set-tier` Stripe-desync guard — Condensed design (#259)

**Issue:** [EnterpriseBT/portal-ai#259](https://github.com/EnterpriseBT/portal-ai/issues/259) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `portalai org set-tier` writes `organizations.tier` directly, with no check on whether the org has a **live Stripe subscription**. For a paid org the tier is webhook-driven from Stripe (the authoritative writer); a manual set-tier bypasses that and silently desyncs the app from Stripe (hit during the #241/#257 app-dev smoke — DB said `standard` while Stripe billed `pro`). Fix in **`packages/admin-cli`** only: make the desync impossible to do *silently* — refuse `set-tier` on a subscribed org unless an explicit override flag is passed. Guarding, not syncing: full two-way sync needs Stripe write access + proration handling and is out of scope for the app-data CLI.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `orgSetTier` command | `packages/admin-cli/src/commands/org.ts:42` | `beginMutation` (guard) → `store.setTier` → `audit`; **no `stripeSubscriptionId` check** |
| store `setTier` | `packages/admin-cli/src/store.ts:150` | loads `current = getOrg(id)` for `previousTier`, then updates `tier` |
| `set-tier` wiring | `packages/admin-cli/src/bin.ts` (`org.command("set-tier")`) | args `<id> <tierSlug>`; `flags(o)` → `{yes, confirmProd}` |
| `MutateFlags` | `packages/admin-cli/src/commands/common.ts:17` | `{ yes?, confirmProd? }` — the flag bag to extend |
| Org model has the field | `packages/core/src/models/organization.model.ts:22` (`stripeSubscriptionId`) | present on the core model… |
| **admin-cli org mirror** | `packages/admin-cli/src/tables.ts` (`organizations`) | …but the CLI's own minimal drizzle mirror **omitted the stripe columns**, so `getOrg`'s `select()` never returned them. The subset parity test (`tables-parity.test.ts`) allows omission, so it didn't flag it. **Fix must add `stripe_customer_id` + `stripe_subscription_id` to the mirror** (+ the PGlite test DDL). *(Caught by the #259 smoke — the command unit test mocked `getOrg` and masked the gap.)* |
| Conflict error + exit | `packages/admin-cli/src/errors.ts` (`AdminConflictError`) → `output.ts` `ADMIN_CONFLICT = 9` | reused for the refusal — no new code |
| `org get` output | `bin.ts` (`org.command("get")`) | dumps the full org JSON — surfaces `stripeSubscriptionId` **once the mirror projects it** (above) |

## Decision — refuse on a live subscription, explicit override to bypass

In `orgSetTier`, after `beginMutation`, fetch the org and if `stripeSubscriptionId != null` **and** the new `--allow-stripe-desync` flag is **not** set, throw `AdminConflictError` (**exit 9**) with a message: the org has an active Stripe subscription (`sub_…`), which drives its tier — change or cancel it in Stripe / the billing portal, or pass `--allow-stripe-desync` to override. Otherwise proceed as today.

- **Where:** the command layer (`orgSetTier`), not the store — keeps the store a generic seam and the guard beside the existing guard→store→audit orchestration. One extra `getOrg` read before `setTier`.
- **Flag:** extend `MutateFlags` with `allowStripeDesync?: boolean`; add `--allow-stripe-desync` to the `set-tier` command; thread via `flags(o)`.
- **Error/exit:** reuse `AdminConflictError`/`ADMIN_CONFLICT` (9) — a set-tier that conflicts with the org's live billing state. No new error code.
- **Rejected:** (a) hard-coded refuse with no override — blocks legitimate bespoke moves; (b) warn-only — misses in automation (a gate must be enforced, per the repo convention); (c) actually reconciling Stripe from the CLI — needs Stripe write creds + proration, out of scope.
- `org get` already surfaces `stripeSubscriptionId` in its JSON, so no display change is needed (the guard message names the sub id inline).

## Plan — 1 slice

**Files**
- Edit: `packages/admin-cli/src/tables.ts` — add `stripe_customer_id` + `stripe_subscription_id` to the `organizations` mirror so `getOrg` projects them (**the load-bearing fix** — the guard is inert without it).
- Edit: `packages/admin-cli/src/commands/common.ts` — `MutateFlags` gains `allowStripeDesync?: boolean`.
- Edit: `packages/admin-cli/src/commands/org.ts` — `orgSetTier` fetches the org and refuses (`AdminConflictError`) when `stripeSubscriptionId != null && !flags.allowStripeDesync`.
- Edit: `packages/admin-cli/src/bin.ts` — add `--allow-stripe-desync` to `org set-tier`; pass it alongside `flags(o)`.
- Edit: `packages/admin-cli/src/__tests__/helpers/test-db.ts` — add the two columns to the PGlite `organizations` DDL.
- Edit: `packages/admin-cli/COMMANDS.md` — document the guard + override on `org set-tier`; note exit 9.

**Tests** (`cd packages/admin-cli && npm run test:unit`)
- `src/__tests__/store.test.ts`: `getOrg` returns the Stripe linkage fields — the regression pin the subset parity test can't provide (a dropped mirror column would silently re-break the guard).
- `src/__tests__/commands.test.ts`: `orgSetTier` on an org with `stripeSubscriptionId` set → throws `AdminConflictError` (`ADMIN_CONFLICT`), **no** `setTier` write, **no** audit, store still released; with `--allow-stripe-desync` → proceeds (writes + audits); `stripeSubscriptionId = null` → proceeds unchanged.

## Smoke (manual, against your dev stack)

Preflight: `git checkout fix/org-set-tier-stripe-guard`, `npm install`, `npm run build --workspace=@portalai/admin-cli` (npx/dist runs the built CLI). Use `--env local` with `DATABASE_URL` exported.

1. Seed/find a local org with a **live** subscription — set `stripe_subscription_id` on an org row (`db:studio` or SQL). Run `node packages/admin-cli/dist/bin.js org set-tier <orgId> standard --env local`. **Expect:** non-zero **exit 9**, message naming the subscription + directing to Stripe; `--json` envelope `{"error":{"code":"ADMIN_CONFLICT",…}}`; the org's `tier` is **unchanged** (verify in `db:studio`).
2. Re-run with `--allow-stripe-desync`. **Expect:** exit 0, tier updated (the conscious override).
3. An org with `stripe_subscription_id = NULL`: `org set-tier <orgId> pro` → exit 0, tier updated (unchanged behavior).
4. `org get <orgId> --env local --json` shows `stripeSubscriptionId` in the payload (linkage visible).

## Out of scope

- Any Stripe write from the CLI (cancel/switch a subscription) — needs Stripe creds + proration; the guard replaces the need.
- Detecting a *value* mismatch (DB tier vs the subscription's actual Stripe price) — needs a Stripe read; the guard keys only on "has a live subscription."
- The in-app upgrade/downgrade flow — separate feature **#260**.
