# remove_default_station — Smoke Suite

Manual smoke test for [#1114](https://github.com/EnterpriseBT/portal-ai/issues/1114): the org-wide default station is gone from the web app, the org API, provisioning, station delete and the admin CLI. The `default_station_id` column stays in the database until #1118. **Branch under test:** `feat/1114-remove-default-station` (PR [#1117](https://github.com/EnterpriseBT/portal-ai/pull/1117)).

Run **§Preflight** once. After that, each section stands alone. Steps tagged `— backend` are API, CLI or DB checks outside a browser walk; `— manual` steps need a human.

---

## Preflight

### Environment

- [ ] `git checkout feat/1114-remove-default-station && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`: the core Organization model lost a field, so the API needs the rebuilt dist. Restart the API afterwards, since nodemon doesn't watch core.
- [ ] No migration: the column is left in place on purpose.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000).
- [ ] For §6, `npm run build --workspace=@portalai/admin-cli` (npx runs `dist/`), with `packages/admin-cli/.env` carrying a local `DATABASE_URL`.

### Fixtures

- [ ] Signed in as the e2e owner in the seeded `e2e-fixture` org (`npm run --workspace @portalai/e2e e2e:seed`), which has Administrate and Playground plus at least one station of your own.
- [ ] For §5, a **past** default-station audit entry in that org. Nothing writes these any more, so insert one from `db:psql` / `db:studio` (replace `<org>` and `<owner>`):
  ```sql
  INSERT INTO audit_log (id, created, created_by, organization_id, user_id, action, target_type, target_id, outcome, metadata)
  VALUES ('smoke-1114-audit', (extract(epoch from now())*1000)::bigint, '<owner>', '<org>', '<owner>',
          'org.update', 'organization', '<org>', 'success',
          '{"field":"defaultStationId","from":null,"to":"st-x","toName":"Legacy Station"}');
  ```

### Reset between runs

- [ ] Delete the stations and portals the walk created (§2, §4). Delete the smoke audit row: `DELETE FROM audit_log WHERE id = 'smoke-1114-audit';`. For §6, `portalai org delete` the org you created.

---

## §1 — No web surface names a default station

- [ ] Open **Stations** (`/stations`). No card shows a "Default" chip, and no card's action menu offers "Set as default".
- [ ] The Stations page header shows no default-station line (the old "Default station: …" meta is gone).
- [ ] Open **Dashboard** (`/dashboard`). It shows no default-station line or link.
- [ ] Open the Administrate station's detail page. Its metadata list has no "Organization Default" row.
- [ ] Open **Help** and search "default station". No glossary term "Default Station" comes up, and no FAQ answer calls Administrate "the default".

## §2 — New Portal picks a station explicitly

- [ ] From the Dashboard (or wherever "New Portal" lives), open the **New Portal** dialog. The station picker starts **empty**: Administrate isn't preselected.
- [ ] Press **Create** with no station picked. The dialog stays open, and the picker shows **"Station is required"** with `aria-invalid="true"`.
- [ ] Pick **Playground** and press Create. The portal opens, and its header or breadcrumb names Playground.

## §3 — The org API is rename-only

Run these from the walk browser's console, or with curl and a bearer token from the signed-in session.

- [ ] `GET /api/organization/current`. The organization payload has **no** `defaultStationId` key, and the capability map has **no** `station.default.set` entry. — backend
- [ ] `PATCH /api/organization/<org>` with `{"defaultStationId":"<any station id>"}` answers **400 `ORGANIZATION_INVALID_PAYLOAD`**, and the message names `defaultStationId`. — backend
- [ ] `PATCH /api/organization/<org>` with `{"name":"<current name> 2","defaultStationId":"x"}` also answers 400, and the name is unchanged. — backend
- [ ] Settings → General: rename the organization, then rename it back. Both saves succeed, and the header shows each new name.

## §4 — Station delete

- [ ] Create a station "Smoke 1114 delete" on `/stations`, then delete it from its card menu. It disappears from the list with a success toast, and no error appears.
- [ ] Settings → Activity: no new "Default station …" entry appears for that delete (only the station's own delete, if Activity records one).
- [ ] Optional: the column is dormant but present. Set `UPDATE organizations SET default_station_id = '<a station id>' WHERE id = '<org>';`, then delete that station from the UI. The delete succeeds, and `default_station_id` still holds the stale id, since nothing reads or clears it. — backend

## §5 — Past default changes still render in Activity

- [ ] With the fixture audit row inserted, open **Settings → Activity**. The entry reads **`Default station set to "Legacy Station"`**.

## §6 — Provisioning and the admin CLI

- [ ] `npx portalai org create --env local --owner-email <your dev login> --name "Smoke 1114" --json`. Stdout is `{"organizationId":"…","stationId":"…"}`, and `stationId` is that org's **Administrate** station (`SELECT name FROM stations WHERE id = '<stationId>'` → `Administrate`). The org also has Playground. — backend
- [ ] In that new org's row, `default_station_id` is `NULL`: provisioning didn't write it. — backend
- [ ] `npx portalai org update <org> --default-station-id x --env local`. It exits **2** (unknown option), and nothing is written. — backend
- [ ] `npx portalai org update <org> --name "Smoke 1114 renamed" --env local --json`. It succeeds, and the name changes. — backend

## §7 — Code sweep

- [ ] `git grep -n "defaultStationId\|default_station_id\|station.default.set" -- ':!apps/api/drizzle' ':!docs'`. The only hits are the audit-summary reader, its tests and the removal tests, the test fixtures that set the dormant column with raw SQL, and comments saying the field is gone. — backend

## Sign-off

- [ ] Every section above verified
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/station/portal ids):
