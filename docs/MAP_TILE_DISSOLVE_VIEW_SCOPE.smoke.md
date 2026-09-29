# map-tile-dissolve-view-scope — Smoke Suite

Manual smoke test for [#643](https://github.com/EnterpriseBT/portal-ai/issues/643) — per-user view-scoping of the portal map (raw/aggregate/hybrid tiles **and** the precomputed polygon dissolve cache), so a viewer is only ever served geometry computed for their own curated-view entitlement. **Branch under test:** `feat/643-map-tile-dissolve-view-scope` (PR [#654](https://github.com/EnterpriseBT/portal-ai/pull/654)).

> **Shape of this walk.** #643 is a **backend** feature — every change is in `apps/api` + `packages/core`; there is no `apps/web` change. So the observable surfaces are (a) map tiles rendering in the portal for different viewers, (b) DB state in `map_dissolve_geometries`, and (c) the maintenance reap via the admin API. Most steps are tagged **— backend** (psql / curl / `db:studio`) or **— manual** (needs a seeded GIS map + a filtered-member login the e2e fixture doesn't ship); the browser-observable slice (`/smoke-walk`-eligible) is thin and called out per step.

## Preflight

### Environment

- [ ] `git checkout feat/643-map-tile-dissolve-view-scope && git pull --ff-only`
- [ ] `npm install`
- [ ] **Apply the migration** — `cd apps/api && npm run db:migrate` (migration `0117_map-dissolve-scope-hash` — adds `scope_hash` + `last_served_at`, re-keys the serve indexes, and **TRUNCATEs** `map_dissolve_geometries`; `npm run dev` seeds but does **not** migrate, so a fresh `0117` 500s the map until you migrate — see `project_dev_seeds_not_migrates`).
- [ ] `npm run dev` boots cleanly (API :3001, web :3000).
- [ ] Confirm `SYSTEM_ID` is set in `apps/api/.env` (the dissolve writer principal); note its value for §2.

### Fixtures

- [ ] A **geo pin with a polygon layer** over a dataset with enough polygons to exceed the tile feature cap at low zoom (parcels-style GIS demo data — the admin-cli demo dataset generator, or your existing dev GIS station). Needed for a real dissolve (individuals + merged coverage).
- [ ] **Two curated views** over that map's entity attached to the pin's station: one unfiltered (or broad) and one with a **row filter** (e.g. `type = 'Federal'`) — plus a **member** user granted *only* the filtered view, and an **admin/owner** who sees both. (This is the multi-scope setup the fixture doesn't ship; create it via `portalai` / seed, or reuse a dev org that already has curated views + member grants.)
- [ ] Local dev identity is `bbgrabbag@gmail.com` (`project_local_dev_identity`); the member/admin split above is what the scope assertions turn on.

### Reset between runs

- [ ] Re-runnable without reset for the read/serve steps. To re-exercise the **eager precompute** (§3) cleanly, re-save/refresh the pin (re-enqueues `dissolve_precompute`). To re-exercise the **reap** (§4), re-seed stale rows (see that section). `TRUNCATE map_dissolve_geometries;` via `db:studio`/psql resets the whole cache (it rebuilds from the pin on next precompute).

## §1 — Per-user tile + dissolve scoping (AC1, AC2)

- [ ] **Admin view** — open the portal holding the geo pin, zoom the map to a **low zoom** (dissolve band, z < ~9). The map renders polygon coverage. *(agent-walkable: map renders + tile requests return 200)*
- [ ] **Member (filtered view) view** — switch to the member granted only the `type = 'Federal'` view, open the same portal/map. The rendered geometry covers **only** the filtered rows (e.g. only Federal parcels) — the member never sees the admin's broader coverage. *(— manual: needs the filtered-member login + visual/known-data judgment)*
- [ ] **No-grant member** — a member with **no** granted view over the map's data sees **no tile and no dissolve** for it (empty map / 204, not another scope's geometry). *(— manual)*
- [ ] Raw, aggregate, and hybrid paths all honor the scope: pan to a sparse envelope (raw individuals), a dense low-zoom envelope (merged coverage), and a mid envelope — each shows only the viewer's rows. *(— manual)*
- [ ] **Backend confirmation** — with the member's session, `curl` a low-zoom tile and confirm a 200 with an `ETag` header; repeat as the admin and confirm the **ETag differs** (different scope → different tile). *(— backend)*
  ```
  curl -sD - -o /dev/null -H "Authorization: Bearer <member-token>" \
    "http://localhost:3001/api/portals/<portalId>/pins/<pinId>/tiles/<z>/<x>/<y>.mvt" | grep -i etag
  ```

## §2 — System principal + scope_hash keying (AC3, AC4)

- [ ] **— backend** After a precompute runs (§3), inspect the cache in `db:studio` (or psql):
  ```sql
  SELECT DISTINCT created_by, scope_hash <> '' AS has_scope FROM map_dissolve_geometries;
  ```
  Every row's `created_by` equals the `SYSTEM_ID` value from preflight, and `has_scope` is `true` (no empty `''` scope on a real row).
- [ ] **— backend** No magic-string principals remain in the shipped code:
  ```
  git grep -n "dissolve_precompute'" apps/api/src | grep -i "created_by\|SYSTEM_REENQUEUE"   # → no principal-string hits
  git grep -n "SYSTEM_REENQUEUE" apps/api/src   # → nothing
  ```
- [ ] **— backend** **Scope re-hash on grant change** — note a member's rendered coverage, then change their grant (e.g. narrow the filter or revoke a column). Re-view: the tile resolves a **new** `scopeHash` (different ETag) and serves the raw fallback for the new scope — never the previous scope's cached geometry. Confirm in psql that the old `scope_hash` rows are not served to the new entitlement.

## §3 — Lazy-fill: first view raw → subsequent dissolved (AC5)

> Note `project_local_env_unsuitable_for_long_jobs`: a dissolve precompute can take 130s+, and this container suspends / nodemon restarts can kill an in-flight job. Run this against a stable dev stack and give the job time.

- [ ] **— backend** Clear the pin's cache for a scope (`TRUNCATE map_dissolve_geometries;` or delete that owner's rows). As the **member**, open the map at a dissolve-band zoom: the **first** view serves the **raw fallback** (tile still renders), and a `dissolve_precompute` job is enqueued (check `GET /api/jobs` or the jobs table for a `dissolve_precompute` row with `metadata.userId` = the member).
- [ ] **— backend** After the job completes, `map_dissolve_geometries` holds rows for that `(owner, scopeHash)`; re-view the same tile → now served **dissolved** (and the ETag has flipped, so a cached client re-fetches rather than staying on the raw tile — the #643 review fix).
- [ ] **— backend** **Lazy-fill dedup** — pan across several tiles of the same map quickly as the member *before* the first job completes: confirm the jobs table does **not** accumulate one `dissolve_precompute` per tile for that (owner, user) — a single non-terminal job suppresses the rest.

## §4 — Orphan-scope reap + live-pin retention (AC6)

- [ ] **— backend** Seed a stale scope: for one owner, insert (or age) a second `scope_hash`'s rows with `last_served_at` older than `DISSOLVE_SCOPE_TTL_MS` (default 30d) while a different scope is fresh. Run the reap:
  ```
  cd apps/api && node dist/... # or trigger the maintenance job; it also runs daily 06:00 UTC
  ```
  Then confirm via `GET /api/admin/maintenance` the `dissolve-scope-retention-purge` run summary shows `{ purged, batches, cutoff }` with `purged > 0`.
- [ ] **— backend** After the reap, the **most-recently-served scope per (owner, column, band) survives** (a live pin keeps its active scope — it must never fall back to raw because the reap got ahead of it); only the superseded, aged-out scope's rows are gone. Confirm in psql.
- [ ] **— backend** `GET /api/admin/maintenance` lists `dissolve-scope-retention-purge` among the registered schedulers (daily `0 6 * * *`).

## §5 — buildSessionViews removed (AC7)

- [ ] **— backend** No remaining production callers / definition of the org-wide builder:
  ```
  git grep -n "buildSessionViews" apps/api/src | grep -v "__tests__"   # → only historical comments, no method def or call
  ```
- [ ] **— backend** `cd apps/api && npm run type-check && npm run lint` pass (the removal left no orphaned imports).

## §6 — Regression: existing map behavior intact

- [ ] **— manual** A non-geo portal (data-table / chart pins) is unaffected — open one, it renders normally.
- [ ] **— manual** A single-view (or owner-of-everything) user's map looks the same as before #643 — scoping is transparent when the caller can see everything.

## Sign-off

- [ ] Every section above verified (agent evidence reviewed for the walkable steps; backend/manual steps walked against my own stack)
- [ ] ______ (date + name) — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/pin/job/scope_hash):
