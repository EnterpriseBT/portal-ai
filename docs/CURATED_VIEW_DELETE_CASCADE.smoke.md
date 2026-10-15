# curated-view-delete-cascade — Smoke Suite

Manual smoke test for [#802](https://github.com/EnterpriseBT/portal-ai/issues/802). It covers:

- Deleting a connector or entity deletes its curated views, detaches them from stations and removes their grants. The delete dialogs count those views.
- Deletes go two-phase: everything visible is deleted in the request, and an `entity_data_delete` job removes the records. The retention purge reclaims anything that job leaves behind.
- Org delete and reset work for an org that has views.
- A field mapping a view uses can't be deleted, dropped by a re-commit, or (if a filter names it) have its key renamed.
- Migration 0121 repairs views that earlier deletes left orphaned.

**Branch under test:** `fix/802-curated-views-survive-connector-delete` (PR [#806](https://github.com/EnterpriseBT/portal-ai/pull/806)).

Run **§Preflight** once. After that the sections are independent; each builds its own throwaway connector. Steps tagged `— manual` need a human. Steps tagged `— backend` are a shell / `psql` / `db:studio` check. Everything else is agent-walkable with `/smoke-walk`.

Filing bugs: open an issue against `EnterpriseBT/portal-ai` with type `Bug`, linking this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout fix/802-curated-views-survive-connector-delete && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`. Core gained the `entity_data_delete` job type and new contract fields.
- [ ] `cd apps/api && npm run db:migrate && cd ../..` — `backend`. This applies:
  - `0121_delete-orphaned-curated-views.sql` (data repair)
  - `0122_entity-data-delete-job-type.sql` (`ALTER TYPE job_type ADD VALUE 'entity_data_delete'`)

  `npm run dev` seeds but doesn't migrate, so this step is required.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). The API log shows the jobs worker attached with the `entity_data_delete` processor registered (no "No processor registered" errors).
- [ ] The e2e session is fresh: `npm run --workspace @portalai/e2e e2e:auth`. Login lands on the dashboard as the e2e-fixture **owner**.

### Fixtures

Every section builds its own disposable data, so nothing in the e2e-fixture org is harmed.

| Alias | How to make it | Used by |
|---|---|---|
| **upload-connector** | **Connectors → New → File upload.** Upload the bundled sample CSV (the workflow's *Sample files* link). Commit it, then note the connector id and its entity id (call that entity **E**). | §1–§4, §6 |
| **station S** | **Stations → New station** named `Smoke 802`. | §1–§3 |
| **view V** | **Views → Create View** over entity **E**: label `Smoke view`, key `smoke_view_<n>`, pick 2 columns, and add a row filter on one of them (e.g. `email` *is not empty*). Then on station **S**, **Edit → Attach views → `Smoke view`**. | §1–§3, §6 |

### Reset between runs

- [ ] No reset needed: each section deletes what it builds. Leftover throwaway connectors can be deleted from **Connectors**.

---

## §1 — Entity delete removes its views

Uses **upload-connector** + **station S** + **view V**.

- [ ] Open entity **E** (`/entities/<E>`), then **⋯ → Delete**. The **Delete Connector Entity** dialog's impact list includes **"1 curated views"** alongside the records, field mappings and the other counts.
- [ ] Confirm **Delete**. The dialog closes and the app navigates to `/entities` within a couple of seconds (no spinner past the 30s timeout, no `REQUEST_TIMEOUT` alert).
- [ ] **Views**: `Smoke view` is no longer listed.
- [ ] Navigate to `/views/<V>`. The page shows the not-found state. In the browser network panel, `GET /api/curated-views/<V>` answers **404 `CURATED_VIEW_NOT_FOUND`**, not 500.
- [ ] **Stations → Smoke 802**: the station lists no attached views. Without a page reload, the list refreshed by itself (the stations query was invalidated).
- [ ] `backend` — in `db:studio`, `permission_grants` has no row with `resource_id = '<V>'` or `condition_param = '<V>'`. `station_views` and `curated_view_field_mappings` rows for `<V>` have `deleted` set.
- [ ] `backend` — the DELETE response (network panel) is `{ id, cascaded: { fieldMappings, entityTagAssignments, entityGroupMembers, curatedViews: 1 }, recordsJobId: "<uuid>" }`, with no `cascaded.entityRecords`.
- [ ] **Jobs**: a **"Delete entity data"** job for that id is listed and reaches **completed**. In `db:studio` → `jobs`, its `result` is `{ recordsDeleted: <the sample's row count>, wideTablesDropped: 1 }`.
- [ ] `backend` — `entity_records` for **E** all have `deleted` set, and `SELECT to_regclass('public."er__<E>"')` returns null.

## §2 — Connector delete removes every entity's views

Build a fresh **upload-connector**, then two views over its entity (or one view per entity if the sample yields two), both attached to **station S**.

- [ ] **Connectors → the connector → ⋯ → Delete**. The **Delete Connector Instance** dialog lists **"2 curated views"** and **"1 stations will be unlinked"** (when the connector is on a station).
- [ ] Confirm. The app lands on `/connectors` promptly and the connector is gone.
- [ ] **Views** lists neither view, and **Stations → Smoke 802** lists no attached views and no connector.
- [ ] `backend` — the DELETE response is `{ id, recordsJobId: "<uuid>" }`. A **Delete entity data** job completes, and its metadata (`db:studio` → `jobs.metadata`) carries every entity id and `connectorInstanceId: <id>`.
- [ ] `backend` — a connector with no entities (create one and cancel before committing a plan, or use an empty sandbox connector): deleting it answers `{ id, recordsJobId: null }` and creates no job.

## §3 — Records can't be written while the delete job is pending

Proves nothing writes a deleted entity's records while its job hasn't run yet.

- [ ] `backend` — stop the worker so the job stays pending: stop `npm run dev` and start only the API without workers, or note this step is covered by `connector-entity.router.integration.test.ts` ("while the records job is pending, no write reaches the entity's records") and mark it verified from CI. — manual
- [ ] With the job pending, an agent prompt on station **S**: **"Geocode the address column of <E's label>"**. The agent's `bulk_geocode_records` call fails with **CONNECTOR_ENTITY_NOT_FOUND** (or the station-scope refusal), and no `bulk_geocode` job appears in **Jobs**.
- [ ] `backend` — `curl -X PATCH :3001/api/connector-entities/<E>/records/<recordId>` with a valid token and body answers **404 `CONNECTOR_ENTITY_NOT_FOUND`**.

## §4 — Large delete returns promptly — manual

- [ ] Generate a ≥ 400K-row CSV with the admin-cli fixture generator, or any large CSV, and import it through **File upload**. Wait for the import job to complete.
- [ ] Delete the entity. The request returns in a few seconds (network panel: DELETE `< 5s`), well under the 30s web timeout, and the UI shows no timeout alert.
- [ ] **Jobs**: the **Delete entity data** job is listed while running, shows progress, and completes. `result.recordsDeleted` equals the imported row count.

## §5 — Stranded records are reclaimed — backend

The backstop for a delete job that never ran.

- [ ] In `psql`, make an entity look like a delete whose job was lost. Pick a throwaway entity with records and run `UPDATE connector_entities SET deleted = (extract(epoch from now() - interval '8 days')*1000)::bigint, deleted_by='smoke' WHERE id = '<id>';`. Leave its records live.
- [ ] Run the daily purge once:

  ```sh
  cd apps/api && npx dotenv -e .env -- tsx -e "import('./src/queues/processors/entity-record-retention-purge.processor.ts').then(m => m.entityRecordRetentionPurgeProcessor()).then(s => console.log(JSON.stringify(s)))"
  ```

  The summary shows `purgedStranded` equal to the entity's record count and `wideTablesDropped >= 1`.
- [ ] `entity_records` for that entity has **zero rows** (hard-deleted), and `to_regclass('public."er__<id>"')` is null.
- [ ] Repeat with `interval '1 day'`. `purgedStranded` is `0` and the records are untouched, because the orphan window is 7 days.

## §6 — Field mappings a view uses are pinned

Build a fresh **upload-connector** and **view V** (projecting 2 columns, filtering on one, e.g. `email`). Mapping deletes are refused while the entity has records, so first **Entity → Delete records → Delete all records** and wait for that job to finish.

- [ ] **Column definitions → the column the view projects (not filters on) → its field mapping row on entity E → Delete**. The **Delete Field Mapping** dialog shows **"Used by curated view "Smoke view""**, an error alert *"…curated views use this field mapping. Edit or delete those views first."*, and **Delete is disabled**.
- [ ] `backend` — `curl -X DELETE :3001/api/field-mappings/<id>` answers **409 `FIELD_MAPPING_DELETE_IN_VIEW`**. The body has `details.curatedViewCount: 1` and contains neither the view's label nor its id.
- [ ] Same for the column the view only **filters** on. The delete is refused the same way.
- [ ] `backend` — rename the filtered column's key: `PATCH /api/field-mappings/<id>` with `{ sourceField, columnDefinitionId, normalizedKey: "renamed_key" }` answers **409 `FIELD_MAPPING_KEY_IN_VIEW`**. The same rename on the *projected-only* column answers **200**.
- [ ] Agent prompt on a station with the entity: **"Delete the email field mapping on <E>"**. The `field_mapping_delete` tool's item fails with *"Cannot delete field mapping "email": 1 curated view uses it…"*, and the mapping is still listed.
- [ ] As the **member** (`npm run --workspace @portalai/e2e e2e:use member`, restart the MCP session), open the field-mapping impact for a mapping the member can read that is used by an owner-only view. The dialog shows **"Used by 1 curated view you can't see"** and no label.
- [ ] **Views → Smoke view → Delete**, then retry the mapping delete. The dialog no longer lists the view, Delete is enabled, and the delete succeeds.

## §7 — Layout-plan re-commit can't drop a used mapping

- [ ] On a fresh **upload-connector** with **view V** projecting the `name` column: **Connector → Edit layout plan**, open the `name` column's binding and tick **Omit this column from the entity**, then **Commit**. The commit is refused immediately with a **409 `FIELD_MAPPING_DELETE_IN_VIEW`** alert naming *"field mapping "name", which this layout plan no longer includes"*. No **Import** job appears in **Jobs**.
- [ ] Omit a column **no** view uses instead and commit. The import job is queued and completes.

## §8 — Org delete and reset with views — manual

Uses a throwaway org, never the e2e-fixture org.

- [ ] `npm run --workspace @portalai/api db:seed:org -- --name smoke-802-throwaway --owner-email <your login>` (`backend`), then switch to it with the org switcher.
- [ ] Build an **upload-connector**, a view over its entity, and attach the view to a station.
- [ ] **Settings → Organization → Delete organization**, then confirm. The delete succeeds (no 500; the API log has no `23503 … curated_view_field_mappings`), and the app returns you to another org.
- [ ] `backend` — `curated_views`, `curated_view_field_mappings`, `station_views` and `permission_grants` have no rows for the deleted org's id.
- [ ] `backend` — repeat with a second throwaway org, but reset it (`npm run --workspace @portalai/api db:reset -- <org-id>`; the org id is the first positional argument, and omitting it resets the first org found, so never omit it). The reset succeeds, and the view tables plus the views' grants are empty for that org.

## §9 — Orphaned views repaired by 0121 — backend

- [ ] Make an orphan the old way. Create a view over a throwaway entity, then soft-delete only the entity in `psql`: `UPDATE connector_entities SET deleted = (extract(epoch from now())*1000)::bigint, deleted_by='smoke' WHERE id = '<id>';`. Confirm the view still lists under **Views** and its `GET …/records` answers 500. This is the pre-#802 bug.
- [ ] Re-apply the repair: `psql "$DATABASE_URL" -f apps/api/drizzle/0121_delete-orphaned-curated-views.sql`. The view is gone from **Views** and its station, and `/views/<id>` answers 404. `deleted_by = 'system'` is set on the view, its links and its attachments, and its grants are gone.
- [ ] Re-run the same file. It changes nothing (the counts are the same before and after).
- [ ] After merge and the app-dev deploy, check app-dev's **Views** list. No view whose entity is deleted is listed, and none 500s on open. — manual

## §10 — Error & edge cases

- [ ] Delete an entity while a **Sync** or **Import** job is running on its connector. The delete is refused with **409 `ENTITY_LOCKED_BY_JOB`** naming the job, and nothing is deleted. The delete may only start once no job holds the scope.
- [ ] Delete a view directly (**Views → Smoke view → Delete**). It behaves exactly as before #802: the response is `{ id, cascaded: { fieldMappings, stationViews, grants } }`, and the station stops listing it.
- [ ] `backend` — with Redis stopped, delete an entity. The delete still answers **200** (the API log has *"entity_data_delete dispatch failed; the retention purge will reclaim the records"*), and the job row stays `pending` until the reconciliation sweep reaps it. §5's purge reclaims the records.

---

## Sign-off

- [ ] Every section above verified, or recorded as covered by CI with the test named
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

```
Section: §<n> — <title>
Expected: <from the step>
Got: <what happened>
Repro: <exact clicks / prompt / command>
Identifiers: org=<id> connector=<id> entity=<id> view=<id> job=<id>
```
