# SUBSCRIPTION_TIER_CARDS — Smoke Suite

Manual smoke test for [#241](https://github.com/EnterpriseBT/portal-ai/issues/241) — the enriched, org-scoped Settings → Subscription & Billing cards (full tier policy + operator blurb + a single-source-of-truth `cta`), per-client **custom tiers** visible only to their org, and the `portalops tier create`/`update`/`description` commands.

**Branch under test:** `feat/subscription-tier-cards` (PR TBD — open with `Closes #241`).

Run **§Preflight** once. The rest can be walked top-to-bottom; each section is independent after preflight. This is a **manual** walkthrough against your own dev stack — nothing here runs itself, and no box is pre-checked.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, type `Bug`, link this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/subscription-tier-cards && git pull --ff-only`
- [ ] `npm install`
- [ ] `npm run build --workspace=@portalai/core` — the tier **model + billing contract** changed; `apps/api` and `apps/web` compile against core's built `dist`, so rebuild it first.
- [ ] `npm run build --workspace=@portalai/devops-cli` — `npx portalops` runs `dist/`, not `src/`; rebuild before any live `portalops tier …` (project memory: stale-dist gotcha).
- [ ] `cd apps/api && npm run db:migrate && cd ../..` — migration **`0072_add_tier_cta_description_visibility`** adds `cta` (NOT NULL DEFAULT 'none'), `description`, `visible_to_organization_id` + the `tiers_cta_check` / `tiers_cta_price_check` constraints + the `visible_to_organization_id → organizations.id` FK. Confirm it applies cleanly (the cyclic FK with `organizations.tier` resolves — no error).
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).
- [ ] Auth0 dev login works — you land in the app as **bbgrabbag@gmail.com** (project memory: local dev identity).

### Converge tier policy (so the cards have data)

- [ ] A fresh `db:seed` seeds **`standard`** with `cta = 'none'` (rides in from the catalog). Confirm in `npm run db:studio` (from `apps/api/`) → `tiers`: `standard.cta = 'none'`.
- [ ] (Optional, to see a **subscribe** card) Converge `pro` locally: with your local Stripe test key exported, from repo root:
      `DATABASE_URL=<local-db-url> STRIPE_SECRET_KEY=sk_test_… npx portalops tier apply --env local`
      Then `tiers.pro.cta = 'subscribe'` and `stripe_price_id` is set. (Local Stripe gotchas: `docs/…` / project memory. If you skip this, §2's "subscribe card" step is N/A locally — verify it on app-dev instead.)

### Fixtures

- [ ] Your current org's id — `npx portalops org list`… no: use **`portalai org list --env local`** (allowlisted read) or `db:studio` → `organizations`. Note it as `<myOrg>`.
- [ ] A **second** org id you are NOT a member of (create one via `portalai` or read another row) — note it as `<otherOrg>`. Used for the isolation check (§3).
- [ ] For every local `portalops`/`portalai` DB command below, prefix with `DATABASE_URL=<local-db-url>` (project memory: local DB ops need it in the shell).

### Reset between runs

- [ ] Custom tiers created here are real rows — delete them when done: `db:studio` → `tiers`, remove the `test_*` slugs (delete the scoped tiers **before** their org, or the FK blocks it). `db:reset-seed` (via `apps/api`) is the clean-slate option.

---

## §2 — Enriched public cards (AC: full policy, Unlimited, blurb, price, owner-gate, current-plan)

Log in and open **Settings → Subscription & Billing**.

- [ ] The **Standard** card shows: name, **"Free"**, and — because it's a public tier — the full policy grid: **Free / Metered / Expensive tools** rows (each showing units + per-minute rate, or **"Unlimited"** where the value is `null`), **Billing period** "Monthly", **When a limit is hit** "Stops at the limit", **Toolpacks** listed by **display name** (e.g. "Data Query, Statistics, …" — not raw slugs), and **Custom toolpacks: Allowed**.
- [ ] `standard`'s metered allocation is `null`/`null` locally → the Metered row reads **"Unlimited"** (not blank, not "null").
- [ ] The current plan (Standard) card carries a **"Current plan"** chip, and the header line reads **Current plan: Standard**.
- [ ] (If `pro` converged) the **Pro** card shows a live price (e.g. **"$49 / month"**) and an enabled **Subscribe** button; its full policy grid renders too.
- [ ] Give a tier a blurb (see §5) and reload — the blurb paragraph appears under the price. A tier with **no** blurb renders cleanly (no empty paragraph).
- [ ] **Responsiveness:** the cards fill the container as a responsive grid — **1 col (xs) → 2 (sm) → 3 (md) → 4 (lg+, capped)** — equal height, no horizontal scroll and no ragged trailing gap. (Fixed during the smoke walk: `SubscriptionBillingUI` uses a CSS grid with `1fr` columns; `TierCardUI` no longer sets a `minWidth`, so the grid cell owns width.)

## §3 — Custom tier is org-scoped data + Contact-support teaser (AC: custom appears only to its org, no Subscribe)

Create a custom tier scoped to **your** org, and one scoped to another org:

- [ ] `DATABASE_URL=… npx portalops tier create --env local --slug test_acme_ent --display-name "Acme Enterprise" --visible-to-org <myOrg> --description "Tailored to your org — unlimited usage, priority support."` → exits `0`, prints the created row.
- [ ] `DATABASE_URL=… npx portalops tier create --env local --slug test_other_ent --display-name "Other Co Enterprise" --visible-to-org <otherOrg>` → exits `0`.
- [ ] Reload Settings → Subscription & Billing. A card labeled **"Enterprise"** appears (the **generic** teaser label — **not** the operator's specific "Acme Enterprise" name, and **no** client-specific blurb, since you're not on it) with a **"Contact support"** link (a `mailto:` — hover/inspect: `mailto:ben.turner@btdev.io`), **no Subscribe button**, and **no policy grid** (no "Metered tools:" row).
- [ ] The **Other Co Enterprise** card does **not** appear (it's scoped to `<otherOrg>` — multi-tenant isolation).

## §4 — On the custom plan: full grid + manage CTA (AC / D6)

- [ ] Switch your org onto the custom tier: `DATABASE_URL=… npx portalai org set-tier <myOrg> test_acme_ent --env local` → exits `0`.
- [ ] Reload Settings. The card now shows the operator's **specific name "Acme Enterprise"** (not the generic "Enterprise"), is the **current plan** (chip present), and shows the **blurb + full policy grid** (all three allocation rows, period, overage, toolpacks) **plus** the CTA reading **"Contact support to manage/update your plan"** (not the bare "Contact support").
- [ ] Switch back so later runs are clean: `DATABASE_URL=… npx portalai org set-tier <myOrg> standard --env local`.

## §5 — Operator blurb: set / clear, excluded from `tier apply` (AC: description edit persists across apply)

- [ ] `DATABASE_URL=… npx portalops tier description --env local --slug test_acme_ent --set "Updated enterprise copy."` → exits `0`. Reload Settings → the Acme card's blurb changed (put your org back on it, or view it as current, to see the grid; the blurb shows in both modes).
- [ ] Run `DATABASE_URL=… STRIPE_SECRET_KEY=sk_test_… npx portalops tier apply --env local` — a subsequent apply must **not** revert the blurb. In `db:studio` → `tiers`, `test_acme_ent.description` is still "Updated enterprise copy." (custom rows are `unmanaged` and untouched; and `description` is excluded from convergence even on catalog rows).
- [ ] `DATABASE_URL=… npx portalops tier description --env local --slug test_acme_ent --clear` → exits `0`; `db:studio` shows `description = NULL`; the card renders cleanly with no blurb.

## §6 — CLI contract: exit codes, guard, audit, --json (AC: guarded, audited, exit 8/9)

- [ ] **Conflict → exit 9:** `DATABASE_URL=… npx portalops tier create --env local --slug standard --display-name "Dup" ; echo "exit=$?"` → prints `exit=9` and does **not** create a row.
- [ ] **Not-found → exit 8:** `DATABASE_URL=… npx portalops tier update --env local --slug ghost --cta contact ; echo "exit=$?"` → `exit=8`. Same for `tier description --slug ghost --clear` → `exit=8`.
- [ ] **`--json` envelope:** append `--json` to the conflict command → stdout is `{"error":{"code":"TIER_ALREADY_EXISTS","message":"…"}}` (parseable; code is not `UNKNOWN`). The human banner went to **stderr**, not stdout.
- [ ] **`tier description` requires exactly one of `--set`/`--clear`:** running it with neither → a usage error (non-zero exit); with both → error.
- [ ] **Guard (local unrestricted):** the local mutations above needed **no** `--yes`. (App-dev enforcement: on app-dev a mutation without `--yes` exits `5` — verify on app-dev if you have AWS creds, else N/A locally; it's covered by the CLI guard unit tests.)
- [ ] **Audit:** `tail ~/.portalai/audit.log` shows one JSONL line per mutation above (`command: "tier create" | "tier update" | "tier description"`, with `env`, `operator`, `args`).

## §7 — Data-driven: no web/api code change (AC: add/remove/reprice/re-describe reflect live)

- [ ] **Add:** creating `test_acme_ent` (§3) made a new card appear with **no** web/api edit and no redeploy — the running dev stack picked it up on reload.
- [ ] **Re-describe:** the §5 blurb edit changed the card copy with no code change.
- [ ] **Remove:** delete `test_acme_ent` (set your org off it first if needed, then `db:studio` delete the row, or scope it away). Reload → the card disappears, no code change.
- [ ] **Reprice (if `pro` converged):** change `pro`'s Stripe price (or its `stripe_price_id`) and re-`tier apply`; the Pro card's price line updates with no web/api change. (Pricing lives in Stripe — memory.)

## §8 — Preserved behavior & degraded states (AC: subscribed/managed/owner-gate/price outage)

- [ ] **Owner gate:** as a **non-owner** member of an org with a subscribe tier, the Subscribe button is **disabled** with the "Only the organization owner can manage billing" tooltip. (Use a member login, or temporarily flip `ownerUserId`.)
- [ ] **Subscribed state:** for an org with a live `stripeSubscriptionId`, the tab shows **"Manage subscription"** (owner-gated) and **no** plan-list cards — unchanged from before.
- [ ] **Managed fallback:** put your org on an **unlisted** bespoke slug (a tier with `selectable = false`, or a slug not visible to you) via `portalai org set-tier`; the tab shows the **"Your plan is managed — contact us to make changes"** banner (the fallback for a current tier absent from the org-scoped list). Restore `standard` after.
- [ ] **Stripe outage degrade:** stop Stripe reachability (or point `STRIPE_SECRET_KEY` at a key that 500s) so `getPrice` returns `null`; the subscribe card's price shows **"—"** while the **Subscribe** affordance (cta) stays present — price degrades, cta does not.

## §9 — Post-conditions

- [ ] `npm run type-check` and `npm run lint` are clean at repo root (also the CI gate).
- [ ] All `test_*` custom tiers are deleted; your org is back on `standard`; `db:studio` → `tiers` has no leftover smoke rows.
- [ ] No org you don't belong to ever showed you its custom tier during the walk.

---

## Sign-off

- [ ] §2 — public cards show every policy dimension; Unlimited for null; blurb + current-plan chip.
- [ ] §3 — custom tier is org-scoped; Contact-support teaser (no grid, no Subscribe); another org's tier is invisible.
- [ ] §4 — on the custom plan: full grid + "Contact support to manage/update your plan".
- [ ] §5 — `tier description` set/clear works and survives a `tier apply`.
- [ ] §6 — exit 9 (conflict), exit 8 (not-found), `--json` envelope, audit line per mutation.
- [ ] §7 — add / re-describe / remove / reprice all reflect with no code change.
- [ ] §8 — owner-gate, subscribed, managed-fallback, and Stripe-outage degrade all preserved.
- [ ] §9 — post-conditions clean; CI green.
- [ ] ______________________  (date + name) — confirmed against my own running stack.

## Bug-filing template

```
**Section:** §<X> — <name>
**Step:** <which step>
**Expected:** <what this doc says should happen>
**Got:** <screenshot / CLI output + exit code / db:studio row>
**Repro:** <exact command or click path>
**Identifiers:** <org id / tier slug>
```
