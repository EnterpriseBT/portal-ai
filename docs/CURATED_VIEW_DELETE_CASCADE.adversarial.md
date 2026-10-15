# curated-view-delete-cascade — Adversarial Review

Adversarial probes for [#802](https://github.com/EnterpriseBT/portal-ai/issues/802). The changes under attack:

- connector and entity deletes cascade into their curated views (station links and grants included), in two phases with an `entity_data_delete` job;
- field mappings a view uses are pinned against delete, re-commit drop and (for filters) key rename, under a per-entity view-dependency lock;
- the retention purge gains a "stranded" scope;
- org delete and reset clear the view tables;
- migration 0121 repairs orphaned views.

**Branch under test:** `fix/802-curated-views-survive-connector-delete` (PR [#806](https://github.com/EnterpriseBT/portal-ai/pull/806)).

The change is delete-, lock- and tenancy-heavy, so §1, §3, §4, §5, §6 and §7 are engaged and §2 is mostly N/A. Untagged probes are browser-drivable; `— backend` probes are API, `psql` or `db:studio` checks; `— manual` probes need a human.

## Preflight

### Environment

- [ ] `git checkout fix/802-curated-views-survive-connector-delete && npm install && npm run build --workspace=packages/core`
- [ ] `cd apps/api && npm run db:migrate` (0121, 0122), then `npm run dev` (web :3000, API :3001)
- [ ] Playwright MCP available. Identities refreshed: `npm run --workspace @portalai/e2e e2e:auth:all` (owner, admin, member).

### Fixtures

- [ ] **Owner's entity E** in `e2e-fixture`: a Sandbox connector, an entity with `name` + `email` mappings and a few records, and a view **V** over it (projecting `name`, filtering `email contains "@"`) attached to a station **S**. The smoke walk's in-page fixture build is a ready recipe.
- [ ] **Member-owned entity M**: an entity **created by the member** (DB `created_by` workaround if the UI won't let the member create one). Over it, an **owner-created view VO** that is *not* shared with the member.
- [ ] **A second org's** entity id, view id and field-mapping id on hand (`My Organization`, or `db:seed:org --name adversarial-802-other`).

### Reset between runs

- [ ] Each probe builds or consumes its own throwaway fixture. Delete leftover `Smoke`/`Adv` connectors and stations afterwards.

## §1 — Boundary & limit inputs

- [ ] Delete an entity with **zero records and zero views**. Expected SAFE: 200, `cascaded.curatedViews: 0`, a `recordsJobId` whose job completes with `{ recordsDeleted: 0, wideTablesDropped: 0|1 }`, and no error in the API log. — backend
- [ ] Delete a connector with **30 entities**, each with a view on one station. Expected SAFE:
  - **one** `entity_data_delete` job whose `connectorEntityIds` has 30 ids;
  - every view gone;
  - the station lists no views;
  - the request returns in seconds (the view cascade is batched, not per view). — backend
- [ ] A view whose filter names the mapping's key **at the maximum filter depth** (`MAX_FILTER_DEPTH` nested groups). Expected SAFE: the mapping delete is still refused with `FIELD_MAPPING_DELETE_IN_VIEW` (`collectFilterFields` walks the whole tree). — backend
- [ ] The field-mapping impact for a mapping used by **11+ views**, some the caller can't read. Expected SAFE: `curatedViews` lists only readable ones, `hiddenCuratedViews` counts the rest, and the dialog renders without layout breakage.

## §2 — Malformed & injection input

- [ ] Rename the filtered key to a **case variant** (`email` → `Email`) or with surrounding whitespace. Expected SAFE: either a 400 from the key pattern, or a 409 `FIELD_MAPPING_KEY_IN_VIEW`. Never a 200 that leaves the filter naming a key that no longer matches. — backend
- N/A otherwise — no new free-text or SQL input surface. The new raw SQL (leftover-table finder, advisory locks, migrations) takes only server-side ids as bound parameters (security review, PR #806).

## §3 — Concurrency & races

- [ ] **Double-activate the entity Delete** (double-click, or click then Enter). Expected SAFE: exactly **one** `DELETE` request (single-flight) and exactly one `entity_data_delete` job row.
- [ ] **Two parallel DELETEs of the same entity** from two tabs/curl. Expected SAFE: one 200, the other **404** (the entity is gone by then). Exactly one view cascade, no duplicate job, no 500. — backend
- [ ] **View create racing a mapping delete.** In `psql`, hold the entity's view-dependency lock (`BEGIN; SELECT pg_advisory_xact_lock(<VIEW_DEPS_LOCK_NAMESPACE>, hashtext('<E>'));`) and soft-delete the `name` mapping. While that is open, create a view projecting only `name`. Expected SAFE: the create **waits**; after `COMMIT` it answers **400** "None of the selected columns exist any more". It must never succeed with a link to a deleted column. — backend
- [ ] **Mapping delete racing a view edit**: the reverse order (hold the lock as a view PATCH would, then delete the mapping). Expected SAFE: the delete waits, then is refused with `FIELD_MAPPING_DELETE_IN_VIEW` if the edit made the view use it. — backend
- [ ] **Delete while a job runs**: start a Revalidation on E (Entity → Revalidate), then delete E immediately. Expected SAFE: **409 `ENTITY_LOCKED_BY_JOB`** naming the job, nothing deleted, and the views and records intact.
- [ ] **Re-commit racing a view create**: enqueue a layout-plan re-commit that drops a column (no view uses it yet), then create a view projecting that column before the job runs. Expected SAFE: the commit job fails **once** (no retries; job `attempts` = 1) with `FIELD_MAPPING_DELETE_IN_VIEW`, the mapping and view stay intact, and nothing is half-written for that target. — manual (needs a File upload connector and job timing)

## §4 — Auth & permission boundaries

- [ ] As **member**, delete **member-owned entity M**, over which the owner has **view VO** that isn't shared with the member. Expected SAFE (by design):
  - the impact counts **1 curated views** without naming it;
  - the delete removes VO and its grants (a view can't outlive its entity);
  - the member never sees VO's label anywhere: the dialog, the response, the errors.
- [ ] As **member**, open the field-mapping delete dialog for a mapping on M that VO uses. Expected SAFE: "Used by 1 curated view you can't see", **no label**, Delete disabled. The 409 body carries a count only. — backend for the 409 body
- [ ] As **member**, try to delete a field mapping **they can't write** (owner's entity). Expected SAFE: 403 `PERMISSION_DENIED`, or 404 when unreadable. The view-dependency check must not run first and leak a `curatedViewCount` to an unauthorized caller. — backend
- [ ] As **member**, the agent's `bulk_geocode_records` on an entity **outside the station's scope**. Expected SAFE: refused by the scope check before any cost rejection is recorded or a job created. — backend

## §5 — Multi-tenant isolation

- [ ] `DELETE /api/connector-entities/<other org's entity>`. Expected SAFE: **404**, and the other org's entity, views, station links and grants are untouched (check in `db:studio`). — backend
- [ ] `GET /api/field-mappings/<other org's mapping>/impact`. Expected SAFE: **404**, with no `curatedViews` / `hiddenCuratedViews` returned. — backend
- [ ] Create a view in your org whose `fieldMappingIds` contains **another org's mapping id**. Expected SAFE: 400 "Field mapping is not a column of this entity", no row written, and later deletes of that foreign mapping are not blocked by your org's attempt. — backend
- [ ] Your org's entity uses the **same normalizedKey** (`email`) as another org's entity that has a filtering view. Delete or rename your mapping. Expected SAFE: allowed: the dependency check is org- and entity-scoped. — backend

## §6 — State & lifecycle abuse

- [ ] **Already deleted**: `DELETE` the same entity again, and `DELETE /api/curated-views/<an already-cascaded view>`. Expected SAFE: both **404**, no job created, no 500. — backend
- [ ] **Attach a cascaded view**: `POST /api/curated-views/<deleted view>/attach { stationId }`. Expected SAFE: 404 `CURATED_VIEW_NOT_FOUND`, and no `station_views` row created. — backend
- [ ] **Create a view on a deleted entity** (an id from before the delete). Expected SAFE: 400/404, no `curated_views` row. — backend
- [ ] **Edit a view to project only a deleted column**: PATCH an existing view's `fieldMappingIds` to `[<deleted mapping id>]`. Expected SAFE: 400 "None of the selected columns exist any more". The projection must never be stored as `[]`, which would widen it to every column. — backend
- [ ] **Re-delivered delete job**: re-run a completed `entity_data_delete` job's processor with the same metadata. Expected SAFE: `{ recordsDeleted: 0, wideTablesDropped: 0 }`, nothing else touched. — backend
- [ ] **Forged job metadata naming a live entity**: insert an `entity_data_delete` job row whose `connectorEntityIds` names a **live** entity and run it. Expected SAFE: the entity is skipped (warn logged), and its records and wide table are untouched. — backend
- [ ] **Agent session after the delete**: in a portal on station S opened *before* E was deleted, ask "What views do I have?" / "Query Smoke view". Expected SAFE: the agent's `station_context` no longer lists V; a query naming V gets a clean not-found, not a 500 or stale data.

## §7 — Misuse sequences

- [ ] **Rename round-trip**: with no filtering view, rename `email` → `contact_email`; create a view filtering on `contact_email`; rename back to `email`. Expected SAFE: the second rename is refused with `FIELD_MAPPING_KEY_IN_VIEW`.
- [ ] **Delete the view's station first, then the entity**. Expected SAFE: the station delete detaches the view; the later entity delete still deletes the view; no 500 from a missing attachment.
- [ ] **Browser back after delete**: delete E, then press Back to `/entities/<E>`. Expected SAFE: the app's not-found state, no crash, and no write is attempted from the stale page (e.g. clicking Create Record → 404 surfaced in a dialog alert).
- [ ] **Re-commit that omits a column, after deleting the view that used it**: edit the plan to omit `name` while V uses it (expect 409), delete V, retry. Expected SAFE: the retry succeeds, the `name` mapping is soft-deleted, and no view remains linked to it. — manual (File upload connector)

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | | |

## Sign-off

- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

```
Section: §<n> — <category>
Probe: <the hostile action, verbatim>
Expected (safe): <from the probe>
Got: <what happened>
Repro: <exact clicks / prompt / request>
Identifiers: org=<id> connector=<id> entity=<id> view=<id> mapping=<id> job=<id>
```
