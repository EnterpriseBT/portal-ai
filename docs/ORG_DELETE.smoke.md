# org-delete — Smoke Suite

Manual smoke test for [#197](https://github.com/EnterpriseBT/portal-ai/issues/197) — owner-initiated organization deletion: Settings Danger zone → server-verified type-to-confirm → full cascade (content hard-purged, `er__*` tables dropped, S3 objects removed, org + memberships tombstoned, `usage` retained) → sign-out. **Branch under test:** `feat/org-delete`.

Run **§Preflight** once. §1–§3 are non-destructive and can be walked in any order; **§4 destroys the target org** — walk it last, then §5/§6. Filing bugs: issue on `EnterpriseBT/portal-ai`, type `Bug`, template at the bottom.

**⚠️ Do not walk §4 against an org you care about.** Use the disposable fixture org below.

---

## Preflight

### Environment

- [ ] `git checkout feat/org-delete && git pull --ff-only`
- [ ] `npm install` — **no migration on this branch** (no schema change; the cascade uses existing columns).
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`); Auth0 dev login lands on `/dashboard`.
- [ ] Redis is reachable (the job-lock check reads the `jobs` table, but leftover BullMQ workers log cleanly).
- [ ] Note whether `UPLOAD_S3_BUCKET` is set in your API env. If it isn't, the post-delete S3 cleanup will log `warn` lines instead of `Deleted S3 object` — that's the expected best-effort behavior, not a failure (§4 has both variants).

### Fixtures

The walkthrough needs a **disposable, populated target org** (owned by you) and your **regular dev org as the untouched control**.

- [ ] Seed the target: `npx portalai seed org --name "Smoke Delete Me" --member-email <your-email> --env local --yes`, then `npx portalai member switch <printed orgId> <your-email> --env local --yes` and refresh the app — you're in the target org. Record the printed `<orgId>`.
- [ ] Populate it so the cascade has something real to destroy:
  - [ ] Import a CSV via the **file-upload connector** and commit the layout plan — this creates a connector instance, entity, field mappings, records, an `er__<entityId>` wide table, and a `file_uploads` row. Record the `<entityId>` (visible in the entity URL or `db:studio` → `connector_entities`).
  - [ ] Open a portal and send one message (portal + portal_messages rows).
- [ ] Add a second (non-owner) member you can log in as: `npx portalai member add <orgId> <second-email> --env local --yes`.
- [ ] Confirm the org has `usage` rows (Settings → Organization shows non-zero or zero usage; any row counts — if none exist, trigger one metered tool call, e.g. a `web_search` in a portal).

### Reset between runs

- [ ] §4 is one-way. To re-run the suite, re-seed a fresh target org (new name) and repeat Fixtures. Switch back to your control org afterward: `npx portalai member switch <controlOrgId> <your-email> --env local --yes`.
- [ ] `cd apps/api && npm run db:studio` — you'll use it throughout §3–§5.

---

## §1 — Danger zone & type-to-confirm dialog (slices 4–5)

In the app, as the **owner**, inside the target org:

- [ ] Settings → **Organization** tab: a **Danger zone** section renders below "Subscription & Usage" with warning copy ("Permanently delete this organization … cannot be undone") and a red-outlined **Delete organization** button.
- [ ] Click it. A **Delete Organization** dialog opens; the warning names what's destroyed (stations, portals, connectors, records, uploads), says every member loses access and you'll be signed out, and the confirmation `TextField` (label `Type "Smoke Delete Me" to confirm`) is auto-focused.
- [ ] The red **Delete organization** button is **disabled** while the field is empty.
- [ ] Type `smoke delete me` (wrong case) — still disabled. Click away (blur): the field shows the error state + helper text "Enter the organization name exactly to confirm".
- [ ] Type the exact name `Smoke Delete Me` — the button **enables**. Add leading/trailing spaces — still enabled (trim-tolerant).
- [ ] Press **Cancel**. Reopen the dialog: the input is **cleared** and the button disabled again. Close it (do **not** confirm yet).

## §2 — Server-side gates: owner-only + confirmation (slice 3)

- [ ] **Non-owner 403.** Log in (separate browser/incognito) as the second member, `member switch` them into the target org if needed. Settings → Organization → Danger zone → open the dialog, type the **exact** name, confirm. Expected: the dialog stays open and `FormAlert` shows **ORGANIZATION_NOT_OWNER** ("Only the organization's owner can delete it"). Refresh — the org is fully intact.
- [ ] **Confirmation mismatch 400, bypassing the UI.** Grab your owner bearer token (devtools → any API request → `Authorization` header), then:
  `curl -s -X DELETE http://localhost:3001/api/organization/<orgId> -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"confirmationName":"Wrong Name"}'`
  Expected: `400` with `code: "ORGANIZATION_CONFIRMATION_MISMATCH"`.
- [ ] Same curl with `-d '{}'` → `400`, `code: "ORGANIZATION_INVALID_PAYLOAD"`.
- [ ] Same curl against a random uuid path id (correct body) → `404`, `code: "ORGANIZATION_NOT_FOUND"` (foreign org ids don't leak existence).

## §3 — Job lock: 409 on active, auto-cancel queued (slice 2)

Stage the job rows in `db:studio` → `jobs` (fastest way to get a stable `active` job):

- [ ] Insert a row: `organization_id = <orgId>`, `type = connector_sync`, `status = active`, `metadata = {}`, `progress = 0`, plus base columns (`id` = any uuid, `created` = now-ms, `created_by` = `SMOKE`). As the owner, open the delete dialog, type the exact name, confirm. Expected: dialog stays open; `FormAlert` shows **ENTITY_LOCKED_BY_JOB** ("Organization is locked by an in-flight job"). Verify in `db:studio` that nothing was deleted (org row `deleted` is null, stations/records intact).
- [ ] Flip that row's `status` to `completed`, and insert a second row identical but `status = pending`. Leave it — §4 will prove the pending job is swept (it's auto-cancelled, then hard-deleted with the org).

## §4 — Full deletion happy path (slices 2–3, destructive)

As the **owner**, in the target org:

- [ ] Open the dialog, type `  Smoke Delete Me  ` (with spaces — proves server-side trim), confirm. The button reads **"Deleting..."**, then you are **signed out and land on the login page** (Auth0 session cleared).
- [ ] API log shows the `organization-delete` module lines: "Deleting organization" → "Organization cascade committed" (with `wideTablesDropped` ≥ 1 and `s3KeysCollected` ≥ 1) → "Organization deleted".
- [ ] **S3 cleanup:** with `UPLOAD_S3_BUCKET` set, a `Deleted S3 object` debug line per upload (and the object is gone from the bucket); without it, a `warn` "Failed to delete S3 object during organization delete" per key — and the delete still succeeded (best-effort by design).
- [ ] In `db:studio`, keyed by `<orgId>`:
  - [ ] `organizations`: the row **exists** with `deleted` set, `deleted_by` = your user id, `default_station_id` null (tombstone).
  - [ ] `organization_users`: every membership row (owner + second member) has `deleted` set.
  - [ ] `usage`: rows **survive untouched** (`deleted` null, `units_used` unchanged).
  - [ ] Zero rows for the org in each content table: `stations`, `portals`, `portal_messages`, `portal_results`, `connector_instances`, `connector_entities`, `field_mappings`, `entity_records`, `column_definitions`, `entity_groups`, `entity_tags`, `file_uploads`, `jobs` (the §3 `pending` row is gone too — swept), `wide_table_columns`, `api_endpoint_configs`, `organization_toolpacks`.
  - [ ] The wide table is dropped: run `SELECT tablename FROM pg_tables WHERE tablename = 'er__<entityId>'` — zero rows.
- [ ] Log back in as the owner. If the target was your only org you'll see "organization not found" errors — expected today (the no-org onboarding state is out of scope, per the discovery); if you belong to other orgs, you land in the most recent one.

## §5 — Multi-tenant isolation (control org)

- [ ] Switch/log in to your **control org**. Dashboard, entities, records, portals, and Settings all load exactly as before §4; its `er__*` tables still exist; its memberships are live.

## §6 — Help / FAQ (doc-sync)

- [ ] Help view → FAQ → **Organization & Grouping**: "How do I delete my organization?" is present and its answer matches the shipped behavior (owner-only, Danger zone, type-to-confirm, permanent, signed out after, wait for running jobs).

---

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/job/entity ids):
