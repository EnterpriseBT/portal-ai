# job-lock-coverage — Smoke Suite

Manual smoke test for [#769](https://github.com/EnterpriseBT/portal-ai/issues/769). A running job now locks every object it affects, across REST routes, agent tools and job starts. A write in scope gets one `409 ENTITY_LOCKED_BY_JOB` naming the job, and the app disables the affordance with the same reason. **Branch under test:** `fix/769-job-lock-coverage` (PR [#771](https://github.com/EnterpriseBT/portal-ai/pull/771)).

Run **§Preflight** once. After that each section stands alone. Steps without a tag are agent-walkable through `/smoke-walk`. Steps tagged `— backend` are curl/psql checks. Steps tagged `— manual` need a human.

---

## Preflight

### Environment

- [ ] `git checkout fix/769-job-lock-coverage && git pull --ff-only`
- [ ] `npm install && npm run build` (core gained `JOB_LOCK_SCOPES`, `JOB_TYPE_LABELS` and `ToolLockSchema`, so the API and web need the rebuilt dist)
- [ ] `cd apps/api && npm run db:migrate`: **`0120_job-lock-scopes.sql`** adds `jobs.lock_scopes text[]` plus a partial GIN index. `npm run dev` seeds but doesn't migrate, so run this first.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000), and BullMQ workers attach without errors.

### Fixtures

- [ ] The e2e fixture org is seeded (`npm run --workspace @portalai/e2e e2e:seed`), and the owner session is fresh (`e2e:auth`).
- [ ] In that org, pick a connector instance **CI** with two entities, **E1** and **E2**, each holding a few records. Pick a column definition **CD** that a field mapping on E1 uses. Record their ids (`db:studio` → `connector_entities`, `field_mappings`).
- [ ] **Holding a job open.** A real revalidation on a small entity finishes in seconds, so most sections seed a live job row instead. Run this from `apps/api` with `psql $DATABASE_URL` (from `apps/api/.env`), using the org id **O** and owner user id **U**:
  ```sql
  INSERT INTO jobs (id, organization_id, type, status, progress, metadata, lock_scopes, attempts, max_attempts, created, created_by)
  VALUES ('smoke-769-job', 'O', 'revalidation', 'active', 0,
          '{"connectorEntityId":"E1"}', ARRAY['entity:E1'], 1, 3,
          extract(epoch from now())*1000, 'U');
  ```
  For an instance-wide job, use `type 'connector_sync'`, `metadata '{"connectorInstanceId":"CI"}'` and `lock_scopes ARRAY['instance:CI']`. Copy any NOT NULL column you're missing from an existing `jobs` row.
- [ ] The reconciliation sweep reaps a row whose `updated` is older than 15 minutes. If a section runs long, refresh it with `UPDATE jobs SET updated = extract(epoch from now())*1000 WHERE id = 'smoke-769-job';`.

### Reset between runs

- [ ] `UPDATE jobs SET status = 'cancelled' WHERE id = 'smoke-769-job';` releases the lock (any terminal status works). Delete the row afterwards if you like.

---

## §1 — Entity and record pages (revalidation on E1)

Seed the revalidation row on E1 first.

- [ ] Open E1's detail page. An info alert lists **"Revalidation"** with a "started … ago" time. Its paused sentence names entity actions, not connector actions.
- [ ] Edit, Create record, Delete records and Re-validate All are each still visible but `aria-disabled`, and their tooltip reads **"Revalidation is running on this entity"**.
- [ ] Open a record on E1. Its Edit and Delete are disabled with the same reason, and the alert shows.
- [ ] Open E2's detail page. There's no alert, and Edit / Create / Delete are enabled, since a job on a sibling entity doesn't lock E2.
- [ ] Cancel the job (Reset). Within a refresh, E1's alert is gone and its actions are enabled again.

## §2 — REST refusals carry the job — backend

With the E1 revalidation seeded, take a bearer token from the browser's network tab and call `:3001` directly.

- [ ] `PATCH /api/connector-entities/E1/records/<recordId>` with a valid body returns **409** with `code: ENTITY_LOCKED_BY_JOB`. The message is "Revalidation is running on this entity. Try again when it finishes.", and `details.runningJobs[0]` has `id: smoke-769-job` and `lockScopes: ["entity:E1"]`.
- [ ] `POST /api/connector-entities/E1/records`, `POST …/E1/records/import` and `DELETE …/E1/records/<recordId>` each return 409 `ENTITY_LOCKED_BY_JOB`.
- [ ] `PATCH /api/field-mappings/<mapping on E1>` returns 409. `PATCH /api/connector-entities/E1` returns 409.
- [ ] `PATCH /api/column-definitions/CD` returns 409, with a message ending "…on an entity that uses this column definition…". `details.runningJobs[0].lockScopes` is `[]`, so the caller doesn't learn E1's id.
- [ ] `PATCH /api/connector-instances/CI` returns 409 ("…one of this connector's entities…").
- [ ] The same `PATCH` on a record of **E2** returns 200, so sibling entities are unaffected.
- [ ] `GET /api/connector-instances/CI/running-jobs` and `GET /api/column-definitions/CD/running-jobs` both list the job with `lockScopes: []`. `GET /api/connector-entities/E1/running-jobs` lists it with `["entity:E1"]`.
- [ ] Neither `BULK_JOB_TARGET_LOCKED` nor `REVALIDATION_ACTIVE` appears in any response above.

## §3 — Instance-wide jobs lock every entity (sync on CI)

Reset, then seed a `connector_sync` row with `lock_scopes ARRAY['instance:CI']`.

- [ ] On the CI page, the alert lists **"Sync"**, and Sync / Edit / Delete are disabled: "Sync is running on this connector".
- [ ] E1's **and** E2's detail pages both show the alert, and their record actions are disabled ("…on this entity's connector" or the equivalent `jobLockReason` copy).
- [ ] Backend check: `PATCH` a record on E2 returns 409 `ENTITY_LOCKED_BY_JOB`. — backend
- [ ] Backend check: `POST /api/connector-instances/CI/sync` returns `SYNC_ALREADY_RUNNING` with `jobId: smoke-769-job` (the UI latches onto it), not a second job. — backend

## §4 — Column-definition page and field-mapping dialogs

Reset, then seed the E1 revalidation.

- [ ] Open CD's detail page. The lock alert shows "Revalidation", and the page's Edit and Delete are disabled with "Revalidation is running on an entity that uses this column definition".
- [ ] In the field-mapping table, every row's **Edit field mapping** and **Delete field mapping** button is `aria-disabled` with the same reason. All rows lock, including ones on other entities; this is deliberate because the summary hides which entity is locked.
- [ ] Cancel the job. The alert clears and the row actions are enabled again, without a manual reload (from the SSE terminal event or the refetch).

## §5 — Job starts conflict on overlapping scope

Reset, then seed the E1 revalidation.

- [ ] On E1, Re-validate All is disabled in the UI. Backend check: `POST /api/connector-entities/E1/records/revalidate` returns 200/202 with the **existing** job `smoke-769-job` (reused), not a new row. — backend
- [ ] Backend check: `POST /api/connector-instances/CI/sync` returns 409 `ENTITY_LOCKED_BY_JOB`, because the instance-wide sync conflicts with the entity job. — backend
- [ ] Backend check: `DELETE /api/connector-entities/E2/records` (the clear job) returns 409 `ENTITY_LOCKED_BY_JOB` ("Revalidation is running on one of this connector's entities"), and E2 keeps its records. A clear locks its whole connector, so it conflicts with an entity job on any of the connector's entities, siblings included. — backend
- [ ] Every job type has a label: on `/jobs` each card is titled with a human name ("Delete records", "Bulk transform", "Geocoding"), never raw `entity_record_clear` / `bulk_geocode`. The Type filter lists every type by that name. Open one job: its title, breadcrumb and Type field use the same name.

## §6 — Agent tools are refused, write nothing, cost nothing

Reset, then seed the E1 revalidation. Use a station whose toolpacks include the record and field-mapping write tools.

- [ ] Prompt: **"Change the <field> of <a record on E1> to <value>."** The agent relays that Revalidation is running on that entity and doesn't retry or split the write. In the tool-call panel, the tool result is `{ error: { code: "ENTITY_LOCKED_BY_JOB", … runningJobs } }`.
- [ ] `db:studio` → `entity_records`: that record is unchanged (`updated` didn't move).
- [ ] Settings → Usage: the call added no units.
- [ ] Prompt: **"Run a bulk geocode on <E1>."** The agent relays a lock refusal, and no `bulk_geocode` row appears in `jobs`.
- [ ] Cancel the job, then repeat the first prompt. The write succeeds.

## §7 — A real job, end to end — manual

- [ ] On a larger entity (a few thousand records), click **Re-validate All**. While it runs, try Edit on a record in the UI (disabled) and via curl (409). After it completes, the alert clears by itself and Edit works.
- [ ] Start a sync on CI. While it runs, confirm E1 and E2 are both locked, and that a different connector's entities are not.

## §8 — Error and edge cases

- [ ] Any non-terminal status locks. Set the seeded row to `status = 'pending'`, then to `'awaiting_confirmation'`: the record `PATCH` returns 409 both times. With `'failed'`, it returns 200. — backend
- [ ] Other orgs never block. Seed the same job row in a **different** org with `lock_scopes ARRAY['entity:E1']`; a write on E1 in the fixture org returns 200. — backend
- [ ] A refused draft-commit import into CI, sent while a sync row holds CI, returns 409, and `connector_instance_layout_plans` gains no new row for CI. — backend
- [ ] Payload redaction: switch to the **member** identity (`e2e:use member`), open `/jobs/smoke-769-job`, and confirm the job shows with no metadata. Backend check: the member's `GET /api/jobs/smoke-769-job` has `lockScopes: []`. — backend

## Sign-off

- [ ] Every section above verified
- [ ] <date + name>, confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/job/entity ids):
