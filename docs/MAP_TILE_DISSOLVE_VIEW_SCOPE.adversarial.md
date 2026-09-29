# map-tile-dissolve-view-scope — Adversarial Review

Adversarial probes for [#643](https://github.com/EnterpriseBT/portal-ai/issues/643) — per-user view-scoping of the portal map (raw/aggregate/hybrid tiles + the precomputed polygon dissolve cache). The feature **is** a member data-exposure boundary, so the probes attack scope isolation, tenant isolation, the ETag validator, and the reap/lazy-fill concurrency. **Branch under test:** `feat/643-map-tile-dissolve-view-scope` (PR [#654](https://github.com/EnterpriseBT/portal-ai/pull/654)).

> **Shape.** #643 is backend-only (`apps/api` + `packages/core`; no `apps/web` change). Probes are mostly **— backend** (crafted `curl` against `:3001`, psql on `map_dissolve_geometries`) or **— manual** (multi-role logins, job timing). The browser-drivable slice is thin. Fixtures are the §Fixtures from `MAP_TILE_DISSOLVE_VIEW_SCOPE.smoke.md`: a polygon geo pin, two curated views (one filtered), a member granted only the filtered view, an admin who sees both, and a **second org** with its own pin for the cross-tenant probes.

## Preflight

### Environment
- [ ] Branch checked out, `npm install`, `cd apps/api && npm run db:migrate` (0117), `npm run dev` up (API :3001, web :3000).
- [ ] Tokens in hand: `<member-token>` (filtered view only), `<admin-token>` (sees both), `<other-org-token>` (a user in a different org). Note the member's resolved `scope_hash` and the admin's from psql after a first view.

### Fixtures
- [ ] The polygon pin + curated views + member/admin grants from the smoke doc's Fixtures.
- [ ] A **second organization** with its own geo pin (`<other-pinId>`) for cross-tenant probes.

### Reset between runs
- [ ] Serve/read probes need no reset. `TRUNCATE map_dissolve_geometries;` (psql/`db:studio`) resets the cache; refresh the pin to re-enqueue a precompute.

## §1 — Multi-tenant isolation (the primary boundary)

- [ ] **— backend** As `<member-token>` (org A), request a tile for `<other-pinId>` (org B): `GET /api/portals/<B-portalId>/pins/<other-pinId>/tiles/<z>/<x>/<y>.mvt`. **Safe:** `404 MAP_TILE_NOT_FOUND` (same 404 as a nonexistent pin — no existence leak, no geometry).
- [ ] **— backend** As `<member-token>`, request a **message-block** tile whose `messageId` belongs to org B. **Safe:** 404, no bytes.
- [ ] **— backend** psql: confirm no `map_dissolve_geometries` row is ever served whose `organization_id` differs from the caller's org — the dissolve serve CTEs carry the owner + scope, and the owner rows are org-scoped. **Safe:** no cross-org row in any served tile.

## §2 — Auth & scope boundary (member sees only their scope)

- [ ] **— manual** Member (filtered view `type='Federal'`) opens the map the admin also sees. **Safe:** the member's tiles cover only Federal rows; the admin's broader coverage is never rendered for the member, at any zoom (raw/aggregate/hybrid).
- [ ] **— backend** **Forge a cross-scope 304.** Capture the admin's tile `ETag` (`E_admin`), then request the same tile as the member with `If-None-Match: E_admin`. **Safe:** the server recomputes the hash under the *member's* scope, the validator mismatches, and it re-renders **200 under the member's scope** — never a `304` that would hand the member the admin-scoped tile the validator names.
  ```
  curl -sD - -o /dev/null -H "Authorization: Bearer <member-token>" \
    -H 'If-None-Match: <E_admin>' \
    "http://localhost:3001/api/portals/<portalId>/pins/<pinId>/tiles/<z>/<x>/<y>.mvt" | grep -iE 'HTTP|etag'
  ```
- [ ] **— backend** A member with **no** granted view over the map's data requests a tile. **Safe:** empty tile (204 / empty MVT), never a fallback to another scope's geometry; the resolved scope is the fail-closed empty-build hash.

## §3 — State & lifecycle abuse (revocation, deletion, reaped scope)

- [ ] **— backend** **Stale-session after revocation.** Member views the map (tile cached client-side with `E_old`). Revoke/narrow their grant. Member re-requests with `If-None-Match: E_old`. **Safe:** the new scope re-hashes → validator mismatch → 200 with the **new (narrower)** scope; the pre-revocation broader geometry is never re-served via a stale 304.
- [ ] **— backend** **Deleted pin.** Soft-delete the pin, then request its tile. **Safe:** 404, no geometry; any in-flight `dissolve_precompute` for it no-ops (owner row gone → `skip`).
- [ ] **— backend** **Reaped scope re-view.** After the reap deletes a superseded scope, a viewer who returns to that scope is served the **raw fallback** (correct data) and a background fill re-enqueues — never an error, never another scope's rows.
- [ ] **— backend** **Missing-userId job.** Enqueue (or hand-craft) a `dissolve_precompute` job whose metadata omits `userId` (pre-#643 shape). **Safe:** the processor **throws loudly** (`missing userId`), the job fails visibly — it does **not** resolve an empty scope and delete the owner's rows.

## §4 — Concurrency & races

- [ ] **— backend** **Lazy-fill burst.** As the member, rapidly request ~10 distinct tiles of the same uncached dissolve map (mimicking MapLibre fanout) before any job completes. **Safe:** the jobs table gains at most **one** non-terminal `dissolve_precompute` for that (owner, user) — the dedup suppresses the rest; the advisory lock serializes any that slip through (extras report `superseded`).
- [ ] **— backend** **Empty-coverage loop.** A scope whose pipeline yields **zero** polygons for a band: the member views it repeatedly. **Safe:** it does not enqueue a fresh job on *every* request — the non-terminal-job dedup caps re-enqueues to one per completion cycle (no unbounded queue growth).
- [ ] **— backend** **Two precomputes, one owner.** Trigger a pin refresh (eager precompute) while a lazy fill for the same owner is in flight. **Safe:** the per-owner advisory lock serializes them; the delete-then-insert is atomic per band, so no half-built or doubled coverage — the later pass reports `superseded` or overwrites cleanly.
- [ ] **— backend** **Reap racing a serve.** Run the reap while actively serving/touching a live scope. **Safe:** the winner-per-`(owner,column,band)` guard keeps the most-recently-served scope; a scope touched during the run stays (its `last_served_at`/`created` recency wins), so a live pin never loses its active scope mid-serve.

## §5 — Malformed & boundary input

- [ ] **— backend** Hand-crafted `If-None-Match` values: a wrong-prefix validator (`"x~<32hex>"`), a prefixless/pre-#532 ETag, a garbage string, an oversized header. **Safe:** each fails the 304 comparison and re-renders a correct 200 (no crash, no 500, no leak) — `parseTileEtag` returns null and the tile re-computes.
- [ ] **— backend** Out-of-range / nonsense tile coords: negative `z`, `z` above the raw handoff, `x`/`y` outside the zoom's grid, non-numeric segments. **Safe:** a clean 4xx or an empty tile — never a 500 or an unscoped query.
- [ ] **— backend** **SQL-injection surface check.** The dissolve serve interpolates `scope_hash` (raw) and quotes `column_name`/`value`. Confirm `scope_hash` only ever originates from `resolveScopeHash` (32-hex) and is never client-supplied — no request path lets a caller set the scope or column literal. **Safe:** no injection point (server-derived hash, UUID-validated org literal).

## §6 — Misuse sequences

- [ ] **— backend** **Scope churn.** Toggle a member's grant back and forth rapidly, viewing the map each time. **Safe:** each entitlement resolves its own `scope_hash` and serves correctly; the cache accumulates per-scope rows bounded by the TTL reap — no stale scope is ever served, and cardinality is bounded, not unbounded.
- [ ] **— manual** **Owner-of-everything unchanged.** An admin/owner who can see all views sees the same map as pre-#643 (scoping is transparent when the caller sees everything) — no regression in the common case.

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| §2 no-grant member tile (live HTTP walk, `curl` against a fresh :3011 instance on branch code) | A member with **no grant** over the map's data got **HTTP 500** (`relation "parcels643a" does not exist`, pg `42P01`) instead of a clean empty tile. The pin's pipeline references a curated view the member isn't granted, so that view's temp view is never created in their per-user session and the tile query fails. **No data leak** (they got an error, not the geometry) — but AC2 says a no-grant member "sees no tile", and a 500 (spammed per tile) is a broken tile, not "no tile". Pre-#643 the org-wide builder made the view for everyone, so this path never fired. | med | **fixed-in-PR** — `runSessionViewTile` now maps a `42P01` from the scoped query to a clean empty tile (→ 204). Re-verified live: member → **204**, owner → 200, forged cross-scope ETag → 204 (not 304), cross-org → 404. Regression test added (`portal-map.router.integration`: a no-grant user → 204, not 500). |

**Probes that held (live HTTP walk, fresh :3011 on branch code, real Auth0 owner + member tokens):** §1 cross-org tile → 404 (owner in org A requesting org B's pin); §2 no-grant member → 204 empty (after fix); §2 forged cross-scope 304 → member sending the owner's ETag gets 204, never the owner's tile (owner ETag `r~6fa14867…` ≠ member scope); §3 owner 304 on own ETag works; §5 malformed `If-None-Match` → 200 re-render (no 500), out-of-range `z=99` → 400, no-auth → 401. Backend (seed script): dissolve rows carried `created_by=SYSTEM` + non-empty `scope_hash` (AC3/AC4); `resolveViewsForSession` resolved owner `[parcels643a]` (scope `c1ad…`) vs member `[]` (scope `240412…`) — service-level isolation is correct. §4 concurrency, §3 reap/missing-userId, §6 misuse: covered by the integration suites (dedup, reap winner-guard, missing-userId guard) — not re-walked live.

## Sign-off

- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] ______ (date + name) — confirmed against my own running stack

## Bug-filing template

Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/pin/job/scope_hash):
