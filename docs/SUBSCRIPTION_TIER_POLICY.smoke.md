# Subscription Tier Policy — Smoke Suite

Manual smoke test plan for [#172](https://github.com/EnterpriseBT/portal-ai/issues/172) — the per-org subscription tier (`tiers` table + `TierPolicy` + `resolveTier`), the per-org `usage` balance (`UsageService.increment` / `getBalance`), the `GET /api/organization/usage` endpoint, and the Settings → Organization tier + usage display. Covers the migration + seed, the FK backfill, the read endpoint, the Settings UI (including the "Unlimited" free class), the increment seam #169 will call, DB-editable charges (no deploy), and bespoke-tier-as-a-row.

**Branch under test:** `feat/subscription-tier-policy` (PR [#175](https://github.com/EnterpriseBT/portal-ai/pull/175)).

Run **§Preflight** once. The rest can be walked top-to-bottom; each section is independent after preflight.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section in the issue body (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/subscription-tier-policy && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core` — core gained `tier.model.ts` / `usage.model.ts` + the `tier`/usage contracts; the API and web need the rebuilt core dist.
- [ ] `cd apps/api && npm run db:migrate && cd ../..` — applies three migrations in order: `0065_create_tiers` (creates `tiers` + inserts the `standard` row), `0066_add_org_tier` (adds `organizations.tier` FK → `tiers.slug`, backfills existing orgs), `0067_create_usage` (creates `usage`). Confirm all three apply cleanly.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).
- [ ] Auth0 dev tenant works — login lands on `/dashboard`.
- [ ] `npm run db:studio` (from `apps/api/`) open in a tab — used throughout for row inspection + SQL.

### Under test

This feature ships **no charging path** (that's #169). The increment seam is exercised manually via SQL / a REPL in §4. Everything else is observable through the endpoint and the Settings tab.

### Reset between runs

- [ ] To reset an org's usage: `DELETE FROM usage WHERE organization_id = '<org>';`
- [ ] To reset an org's tier: `UPDATE organizations SET tier = 'standard' WHERE id = '<org>';`
- [ ] `resolveTier` caches tier policies for ~60s in-process. After editing a `tiers` row, wait out the TTL (or restart the API) before expecting the change to show.

---

## §1 — Migration + seed (the substrate)

- [ ] In `db:studio` → `tiers`: exactly one row, `slug = 'standard'`, `display_name = 'Standard'`, `period_kind = 'monthly'`, `period_anchor_day = 1`, `overage = 'hard-deny'`, `metered_units_per_period = 1000`, `metered_rate_per_min = 20`, `expensive_units_per_period = 100`, `expensive_rate_per_min = 5`, `free_units_per_period` / `free_rate_per_min` **NULL** (unlimited), `per_tool_caps` NULL.
- [ ] `usage` table exists and is empty.
- [ ] **Backfill:** every row in `organizations` has `tier = 'standard'` (including any org that existed before the migration). `SELECT id, tier FROM organizations;` — no NULLs, all `standard`.
- [ ] `npm run db:seed` a second time (from `apps/api/`) does **not** create a duplicate `standard` tier (idempotent). `SELECT count(*) FROM tiers WHERE slug='standard';` → `1`.

---

## §2 — The read endpoint (`GET /api/organization/usage`)

- [ ] Grab a bearer token from the running web app (dev tools → a request's `Authorization` header) and call:
  `curl -s http://localhost:3001/api/organization/usage -H "Authorization: Bearer <token>" | jq`
- [ ] Response is `{ success: true, payload: { tier, usage } }`.
- [ ] `payload.tier.tier === "standard"`; `payload.tier.allocations.metered.unitsPerPeriod === 1000`; `payload.tier.allocations.free.unitsPerPeriod === null`.
- [ ] `payload.usage.periodId` is the current UTC month, `"YYYY-MM"`.
- [ ] With no usage rows: `payload.usage.byClass.metered === { used: 0, available: 1000 }`; `byClass.free === { used: 0, available: null }` (unlimited); `byClass.expensive === { used: 0, available: 100 }`.
- [ ] `GET /api/organization/current` still works and its `payload.organization.tier === "standard"` (the slug rides the existing response with no mapper).

---

## §3 — Settings → Organization display

- [ ] In the web app, go to **Settings** → **Organization** tab.
- [ ] A **"Subscription Tier"** row shows **`Standard`** (the slug rendered as a label).
- [ ] **"Metered usage"** shows `0 used · 1000 available`; **"Expensive usage"** shows `0 used · 100 available`.
- [ ] **"Free usage"** shows `0 used · Unlimited` (the unlimited class renders "Unlimited", not a number).
- [ ] The existing rows (Timezone, Created) still render; the tab doesn't error.

---

## §4 — The increment seam (what #169 will call)

Simulate a charge by inserting/accumulating a `usage` row for the **current period** (`periodId` = current UTC `YYYY-MM`, matching the endpoint), then confirm it surfaces. Use `db:studio` SQL or `psql`.

- [ ] Insert 30 metered units for the org, current period:
  ```sql
  INSERT INTO usage (id, created, created_by, organization_id, period_id, cost_class, units_used)
  VALUES (gen_random_uuid()::text, (extract(epoch from now())*1000)::bigint, 'SMOKE',
          '<org>', to_char(now() at time zone 'utc', 'YYYY-MM'), 'metered', 30);
  ```
- [ ] `GET /api/organization/usage` now reports `byClass.metered === { used: 30, available: 970 }`.
- [ ] Settings → Organization now shows **"Metered usage"** = `30 used · 970 available` (refresh the tab).
- [ ] **Accumulation:** run `UPDATE usage SET units_used = units_used + 10 WHERE organization_id='<org>' AND cost_class='metered' AND period_id = to_char(now() at time zone 'utc','YYYY-MM');` → endpoint shows `used: 40, available: 960`. (This is the effect the real atomic `ON CONFLICT` increment produces per call.)
- [ ] **Period isolation:** insert a row for a *different* `period_id` (e.g. last month); the endpoint's current-period balance is unchanged (it reads only the current period).
- [ ] **Clamp:** set metered `units_used` to `1500` (over the 1000 allocation); endpoint reports `available: 0` (never negative), `used: 1500`.

---

## §5 — DB-editable charges (no deploy)

The whole reason tiers live in the DB — change a charge with SQL, see it take effect without a redeploy.

- [ ] `UPDATE tiers SET metered_units_per_period = 5000 WHERE slug = 'standard';`
- [ ] Wait ~60s (the `resolveTier` cache TTL) **or** restart the API.
- [ ] `GET /api/organization/usage` now reports `tier.allocations.metered.unitsPerPeriod === 5000` and `byClass.metered.available` recomputed against 5000 (e.g. `5000 - used`). No code change, no redeploy.
- [ ] Reset: `UPDATE tiers SET metered_units_per_period = 1000 WHERE slug = 'standard';`

---

## §6 — Bespoke tier as its own row (enterprise deal)

Adding a tier is a row insert; pointing an org at it is a slug update — the discovery's "bespoke deal = its own `tiers` row".

- [ ] Insert a bespoke tier:
  ```sql
  INSERT INTO tiers (id, created, created_by, slug, display_name, period_kind, period_anchor_day, overage,
                     metered_units_per_period, metered_rate_per_min, expensive_units_per_period, expensive_rate_per_min)
  VALUES (gen_random_uuid()::text, (extract(epoch from now())*1000)::bigint, 'SMOKE',
          'enterprise-acme', 'Enterprise Acme', 'monthly', 1, 'soft-alert', 100000, 500, 10000, 100);
  ```
- [ ] Point the org at it: `UPDATE organizations SET tier = 'enterprise-acme' WHERE id = '<org>';`
- [ ] After the cache TTL / restart: `GET /api/organization/usage` reports `tier.tier === "enterprise-acme"`, metered allocation `100000`.
- [ ] Settings → Organization shows **"Subscription Tier"** = `Enterprise Acme` (the slug title-cased) and the new allocations.
- [ ] Reset: `UPDATE organizations SET tier = 'standard' WHERE id = '<org>';`

---

## §7 — FK integrity + fallback

- [ ] **FK rejects an unknown slug:** `UPDATE organizations SET tier = 'does-not-exist' WHERE id = '<org>';` → fails with a foreign-key violation (`organizations_tier_tiers_slug_fk`). The org cannot point at a tier that doesn't exist.
- [ ] **Fallback is safe (informational):** `resolveTier` falls back to `standard` and never throws for a blank/legacy slug — this can't be reached via the FK in normal operation and is covered by unit tests (`tier.service.test.ts`). No manual step needed; confirm no `TIER_DEFAULT_MISSING` errors appear in the API log during the suite (they'd only occur if the `standard` row were deleted).

---

## §8 — No-regression / invariants

- [ ] Existing org-scoped flows are unaffected: dashboard, stations, connectors, portals all load and function as before (the org model just gained a `tier` field).
- [ ] `GET /api/organization/current` is unchanged in shape aside from the added `tier` slug.
- [ ] Deleting a tier that an org references fails (FK) — you must repoint orgs first. (Optional: try `DELETE FROM tiers WHERE slug='standard';` on an org still on standard → FK violation. Do **not** leave standard deleted.)
- [ ] `/api-docs` (Swagger) lists `GET /api/organization/usage` with the `OrganizationUsageGetResponse` schema.

---

## Sign-off checklist

- [ ] §1 (migration + seed) — `standard` seeded with the right numbers; `usage` exists; every org backfilled to `standard`; seed idempotent.
- [ ] §2 (endpoint) — returns tier + zeroed balance; free unlimited; `current` carries the slug.
- [ ] §3 (Settings UI) — tier row + per-class used/available; free shows "Unlimited".
- [ ] §4 (increment seam) — inserted/accumulated usage surfaces in the endpoint + UI; period-isolated; available clamped ≥ 0.
- [ ] §5 (DB-editable charges) — SQL edit changes the resolved allocation after the TTL, no deploy.
- [ ] §6 (bespoke tier) — a new tier row + org repoint resolves and displays.
- [ ] §7 (FK integrity) — unknown slug rejected; default fallback never throws.
- [ ] §8 (invariants) — no regressions; Swagger lists the endpoint.

After every box ticked: report ready-to-merge in the PR thread, or file follow-up bugs against any failing case.

---

## Bug-filing template

```
**Section:** §<X> — <name>
**Step:** <which step>
**Expected:** <what the smoke doc says should happen>
**Got:** <response bodies, screenshots, db row inspections>
**Repro:** <curl / SQL + any preconditions>
**Org id / period:** <from db:studio>
```
