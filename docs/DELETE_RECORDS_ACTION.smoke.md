# delete-records-action — Smoke Suite

Manual smoke test for [#453](https://github.com/EnterpriseBT/portal-ai/issues/453) — the "Delete records" action on the entity view, backed by the queued `entity_record_clear` job with instance-wide locking. **Branch under test:** `feat/delete-records-action` (PR [#486](https://github.com/EnterpriseBT/portal-ai/pull/486)).

## Preflight

### Environment

- [ ] `git checkout feat/delete-records-action && git pull --ff-only`
- [ ] `npm install`, then from `apps/api/`: `npm run db:migrate` (applies `0088_add-entity-record-clear-job-type` — the `job_type` enum gains `entity_record_clear`)
- [ ] Rebuild shared dists after the branch switch: `cd packages/core && npm run build` (stale-dist trap)
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)

### Fixtures

- [ ] A connector entity with a non-trivial record count (a file-upload import of any sample sheet works; ~20+ rows is enough for §1–§4)
- [ ] Its connector instance has **write capability ON** (instance view → capability toggles)
- [ ] For §5 (optional scale sanity): an entity with ~100K+ rows (e.g. re-sync the rest-api smoke instance)

### Reset between runs

- [ ] Records are soft-deleted — re-import (or re-sync) the entity to repopulate; or walk against a fresh import each run

## §1 — Happy path: dialog → enqueue → cleared (slices 1–2, 4)

- [ ] Open the entity's detail view → the Records section header shows a red-outlined **Delete records** button next to Re-validate All / Create
- [ ] Click it → the **Delete All Records** dialog opens with the confirmation field focused, an impact line "You are about to delete **N records** from **\<label\>**" where N matches the Records metadata count, and copy saying the entity/mappings/connector stay intact
- [ ] Type the entity's label exactly and press Enter (or click **Delete all records**) → the dialog closes and an info toast "Deleting records… this can take a few minutes." appears
- [ ] Within moments: an inline lock alert appears above the Records section naming the running job, and the Delete records button disables
- [ ] When the job finishes: a success toast "Deleted N records" (N formatted with separators), the lock alert clears, and the Records count reads **0 without a manual reload**
- [ ] In `db:studio` / psql: `SELECT count(*) FROM entity_records WHERE connector_entity_id='<id>' AND deleted IS NULL` → `0`; same for `SELECT count(*) FROM "er__<id>" WHERE deleted IS NULL` → `0`
- [ ] Parents untouched: the `connector_entities`, `connector_instances`, and `field_mappings` rows for this entity all still have `deleted IS NULL`; the entity view still renders with its mappings
- [ ] The `jobs` table has an `entity_record_clear` row: `status='completed'`, `result` = `{"deleted": N}`, `created_by` = your user id (the durable who/when/how-many record)

## §2 — Instance-wide lock while the clear runs (slices 1–3)

Use an entity big enough that the clear takes a few seconds (or §5's large one).

- [ ] Kick off a clear; while the job is non-terminal, the entity view shows the lock alert and the disabled Delete records button — hover it: the tooltip names the running job
- [ ] While still running, `curl -X DELETE http://localhost:3001/api/connector-entities/<id>/records -H "Authorization: Bearer <token>"` → `409` with code `ENTITY_LOCKED_BY_JOB` and the running job in `details.runningJobs` (a second clear cannot stack)
- [ ] While still running, trigger a **sync** on the same connector instance (UI or API) → refused with `409 ENTITY_LOCKED_BY_JOB` (the review decision: a mid-clear resync is impossible)
- [ ] `GET http://localhost:3001/api/connector-entities/<id>/running-jobs` (with auth) → the clear job listed; after completion → `[]`

## §3 — Confirmation & permission edges (slice 4 + guards)

- [ ] Open the dialog, type a wrong label (e.g. lowercase), submit → field shows `Enter "<label>" exactly to confirm`, `aria-invalid`, focus returns to the field, **no toast, no job row created**, record count unchanged
- [ ] Open the dialog and click **Cancel** → closes with no write (count unchanged, no new `jobs` row)
- [ ] Turn the instance's **write capability OFF** → the Delete records button disables with the "Writes are disabled" tooltip; a direct `curl -X DELETE …/records` → `422 CONNECTOR_INSTANCE_WRITE_DISABLED`. Turn write back ON afterward
- [ ] Force a server error through the dialog (e.g. seed a non-terminal sync job row for the instance, then confirm the dialog) → the dialog **stays open** with the error + code rendered in the FormAlert
- [ ] Swagger (`http://localhost:3001/api/docs`): the DELETE records route documents **202** with the Job schema, and `GET /api/connector-entities/{id}/running-jobs` is present

## §4 — Action-cluster responsiveness (follow-up fix on this branch)

- [ ] On the entity view, narrow the browser window (and/or collapse the navbar) → the Delete records / Re-validate All / Create buttons **wrap onto additional right-aligned lines** inside the Records section instead of spilling past its right edge
- [ ] Spot-check one other view with section action buttons (e.g. connector-instance detail) at a narrow width → no overflow regressions from the shared `PageSection` change

## §5 — Scale sanity (optional, acceptance criterion: no timeout / no OOM)

> **Skipped at sign-off (2026-09-01, user decision):** the 202 decouples clear duration from the HTTP budget by construction, #451's join-delete (measured 66s@400K with flat memory) runs unchanged inside the processor, and the route→processor path is integration-tested end-to-end. Recorded reason per the unchecked-boxes convention.

- [ ] On a ~100K+ row entity: the DELETE returns `202` in under a second; the HTTP request never blocks on the deletion itself
- [ ] The job completes (watch the lock alert / `jobs.status`), memory on the API process stays flat (no id materialisation — the delete is a server-side join), and both tables read 0 live rows afterward

> The remaining acceptance criterion — lint/type-check/test suites green — is CI's box on PR #486, not a manual step.

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/job/entity ids):
