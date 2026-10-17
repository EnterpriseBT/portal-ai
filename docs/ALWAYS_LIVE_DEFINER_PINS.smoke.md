# always-live-definer-pins — Smoke Suite

Manual smoke test for [#640](https://github.com/EnterpriseBT/portal-ai/issues/640). After this change, a data pin (table, chart or map) stores only its query and how to draw it, never rows. Each time someone opens it, the query runs live with the access of the person who pinned it (the definer). If the definer loses that access, the pin goes empty. **Branch under test:** `feat/640-always-live-definer-pins` (PR [#819](https://github.com/EnterpriseBT/portal-ai/pull/819)).

Run **§Preflight** once. Every later section starts from the §0 fixture and doesn't depend on the others, with two exceptions: §5 removes the definer, and §6 revokes their view. Run those two last, or re-run §Reset between them.

Step tags:
- *(none)*: the agent can walk the step in a browser with `/smoke-walk`.
- **— backend**: check it with `curl` or `psql`.
- **— manual**: needs a person's judgment or a hand-prepared state.

**Identities** (the seeded `e2e-fixture` org, #620):

| Alias | Who | Role in this suite |
|---|---|---|
| **Owner** | `E2E_AUTH0_USERNAME` (qa@…) | Builds the fixture, and manages the pin (has `resource.write` on it), so sees the reason when a pin fails |
| **Definer** | the e2e **member** | Pins the results. Reads the data only through one filtered view |
| **Sharee** | the e2e **admin** | Has read-only access to the pin. Has broader data access of its own than the definer |

To switch identity: `npm run --workspace @portalai/e2e e2e:use <owner|admin|member>`, then close the browser and navigate again. In the app, switch into `e2e-fixture` if needed. Copy `.auth/storageState.json` to `.auth/owner.storageState.json` first, so you can switch back to owner. For `curl`, the bearer is the `access_token` inside each `.auth/<role>.storageState.json`.

---

## Preflight

### Environment

- [ ] `git checkout feat/640-always-live-definer-pins && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`. The model and contracts in core changed: definer fields were added, `snapshotUpdatedAt` was removed, and the pinned-content schemas are now strict.
- [ ] **Before migrating**, record any existing pins for §8:
  - `psql "$DATABASE_URL" -c "select id, type, content ? 'rows' as has_rows from portal_results where type in ('data-table','d3','geo')"`
  - Note how many have `has_rows = t`.
- [ ] `cd apps/api && npm run db:migrate && cd ../..`. Two migrations apply:
  - `0124_pin-definer-columns` adds `definer_principal_type` and `definer_principal_id`, backfilled from `created_by`.
  - `0125_strip-pin-snapshots` reduces each data pin's content to its recipe keys and drops `snapshot_updated_at`.
  - `npm run dev` seeds but does not migrate, so this step is required.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). If `:3001` serves stale code (a nodemon zombie), start a fresh API on another port per the #643 notes.
- [ ] `npm run --workspace @portalai/e2e e2e:auth:all && npm run --workspace @portalai/e2e e2e:seed`. This gives three working sessions and a convergent `e2e-fixture`.

### Fixtures (§0, as Owner)

- [ ] Upload `smoke_640_contacts.csv` through **Connectors → File upload**, with 6 rows (columns `email,region,age`):
  - `a@x.co,NE,25`
  - `b@x.co,NE,42`
  - `c@x.co,SW,50`
  - `d@x.co,SW,61`
  - `e@x.co,NE,33`
  - `f@x.co,SW,19`
- [ ] Create a station **"Smoke 640"** with that entity and the `data_query` toolpack.
- [ ] Create a curated view **"Over 30"** (`key: over_30`) on the entity, with filter `age > 30` (4 rows: b, c, d, e). Attach it to the station.
- [ ] Share the **station** (Read) and the **"Over 30" view** (Read) with the **member**. Share neither with the admin. The admin's own role access already covers the whole entity, which §2 relies on.
- [ ] Map and large-result fixture: the REST API connector **"Smoke 640 ArcGIS USA"** (`bcdb3167-8261-4704-8f3b-06c8d7b9b672`). It reads the public, token-free Esri sample server `https://sampleserver6.arcgisonline.com/arcgis/rest/services/USA/MapServer` and has two entities:
  - `usa_states` (`/2/query`, id `state_abbr`): 51 polygons with `state_name`, `sub_region` and population columns.
  - `usa_cities` (`/0/query`, id `objectid`): 3,557 points, paged 1,000 at a time with `resultOffset` / `resultRecordCount`.
  - Each feature's `attributes` and `geometry` are flattened by the transform `[features.$merge([attributes, {"shape": geometry}])]` into a `c_shape` geometry column (EPSG:4326).
  - The first sync gave 3,608 records, all valid. If the connector is missing, recreate it with these settings through **Connectors → Catalog → REST API**.
- [ ] Create a station **"Smoke 640 Map"** with both entities and the `data_query` and GIS toolpacks. Create these curated views and attach them to the station:
  - **"Pacific states"** (`key: pacific_states`): `usa_states` filtered to `sub_region = pacific` (stored in lowercase), which gives 5 states.
  - **"Cities"** (`key: cities`): all of `usa_cities`.
- [ ] Share the station, "Pacific states" and "Cities" with the **member** (Read).

### Reset between runs

- [ ] Re-run `e2e:seed`. It's convergent, so it restores the member's membership after §5.
- [ ] Share "Over 30" with the member again after §6.
- [ ] Soft-delete this suite's pins: `update portal_results set deleted = extract(epoch from now())*1000, deleted_by='SMOKE640' where name like 'Smoke 640%'`. **— backend**

---

## §1 — A pin stores a recipe, never rows (slices 1, 6)

- [ ] As **Definer**, in station "Smoke 640", prompt: **"Show every row of the over_30 view as a table with email, region and age."** A table renders with **b, c, d, e** (4 rows).
- [ ] Click **Pin** on the table and name it **"Smoke 640 table"**. The pin succeeds with a success toast.
- [ ] Inspect the row in `psql`: **— backend**
  - Query: `select type, definer_principal_type, definer_principal_id, jsonb_object_keys(content) from portal_results where name='Smoke 640 table'`
  - Expected: `definer_principal_type = user`, `definer_principal_id` is the member's user id, and the content keys are **only** `columns` and `pipeline`. There is no `rows`, `samplePeek`, `rowCount`, `queryHandle` or `schema`.
- [ ] Prompt: **"Chart the count of rows per region as a bar chart."** Pin the chart as **"Smoke 640 chart"**. Its content keys are a subset of `program, title, params, pipeline`. **— backend**
- [ ] The `portal_results` table has no `snapshot_updated_at` column: `\d portal_results`. **— backend**

## §2 — A sharee sees the definer's data, live (slices 3, 5)

- [ ] As **Definer**, open **Pinned results** (`/portal-results`). The "Smoke 640 table" card shows **no** "Data as … sees it" caption, because the viewer is the definer.
- [ ] As **Definer**, share "Smoke 640 table" and "Smoke 640 chart" with the **admin** (Read).
  - If the member can't share a pin (the share action is hidden), use the Owner to share it instead, and note that in the evidence.
- [ ] As **Sharee** (admin), open `/portal-results`. Both cards carry the caption **"Data as <member's name> sees it"** (`data-testid="pinned-result-definer"`).
- [ ] Open "Smoke 640 table":
  - It shows exactly **b, c, d, e**: the definer's 4 rows, **not** the admin's own 6, even though the admin can read every row.
  - The metadata row reads **"Data — As <member's name> sees it"**.
  - The network tab shows `GET /api/portal-results/<id>/data` → `200`, and **no** `POST …/refresh`.
- [ ] **Live:** as Owner, edit the "Over 30" view's filter to `age > 40`. As **Sharee**, reload the pin. It now shows **c, d, e**. A row edited in the entity (e.g. b's age set to 55) appears the same way.
  - Reload means navigate away and back, or wait 3 minutes. The query cache's `staleTime` matches the 3-minute refresh window.
- [ ] Put the filter back to `age > 30`.
- [ ] The chart pin, opened as Sharee, draws bars from the definer's rows: NE = 2 (b, e) and SW = 2 (c, d).

## §3 — Large pins page for a sharee (slices 2, 3)

- [ ] As **Definer**, in "Smoke 640 Map", prompt: **"Show every row of the cities view as a table with areaname, st and pop2000."** At 3,557 rows the result comes back as a query handle, not inline. Pin it as **"Smoke 640 cities"** and share it with the admin.
- [ ] As **Sharee**, open the pin. Page 2 loads (`GET /api/portal-sql/handle/<h>?offset=…` → `200`).
- [ ] As Definer, unshare the pin from the admin. In the Sharee's tab, request the next page: `curl -H "Authorization: Bearer $ADMIN" :3001/api/portal-sql/handle/<h>?offset=0&limit=10` → **404**. **— backend**

## §4 — Map pins render the definer's data for everyone (slice 4)

- [ ] As **Definer**, in "Smoke 640 Map", prompt: **"Map the pacific_states view, colored by population."** The map shows 5 states. Pin it as **"Smoke 640 map"** and share it with the admin.
- [ ] As **Definer**, prompt: **"Map all cities as points."** This gives 3,557 points, so the pin should have `tiled: true` in its content. Pin it as **"Smoke 640 cities map"** and share it with the admin. Use this pin for the tile checks below.
- [ ] Fetch one tile as each identity. **— backend**
  - Command: `curl -s -o /tmp/<role>.mvt -w '%{http_code}\n' -H "Authorization: Bearer $T" :3001/api/portal-map/tiles/pin/<pinId>/<z>/<x>/<y>.mvt`
  - Expected: the member and the admin both get `200` with **byte-identical** bodies (`cmp /tmp/member.mvt /tmp/admin.mvt`), even though the admin's own access is broader.
- [ ] As **Sharee**, open "Smoke 640 map". It shows the same 5 Pacific states as the definer sees, not all 51, even though the admin can read every state. **— manual** (visual comparison)
- [ ] The tile ETag changes on its own after 3 minutes, so it isn't stuck on stale data. To check, compare the `ETag` header from two fetches more than 3 minutes apart. **— backend**

## §5 — Removing the definer empties the pin (slices 1, 3, 5)

- [ ] As **Owner**, open **Settings → Members** and remove the **member** from `e2e-fixture`.
- [ ] As **Sharee** (admin), open "Smoke 640 table":
  - The info notice reads **"This pin's data isn't available."** (`pinned-data-unavailable`).
  - No table renders.
  - **No** "As … sees it" row appears; the notice doesn't say whose access ended.
  - The network shows `GET …/data` → `422 PORTAL_RESULT_DATA_UNAVAILABLE`.
- [ ] As **Owner**, open the same pin. The warning notice explains the reason, using the server's message for `PORTAL_RESULT_DEFINER_ACCESS_LOST` (`pinned-definer-access-lost`): the definer's access is gone, so re-run the prompt and pin the new result.
- [ ] Map pin from §4, as Sharee: the map shows the `map-widget-tile-unavailable` notice, and a tile `curl` returns `422`. **— backend** for the curl
- [ ] The member's directly attached policies in this org are soft-deleted. **— backend**
  - Query: `select count(*) from policy_attachments where principal_type='user' and principal_id='<member id>' and organization_id='<e2e-fixture id>' and deleted is null`
  - Expected: `0`. Attachments in the member's personal org are untouched.
- [ ] Re-seed (§Reset) to restore the member before §6.

## §6 — Revoking the definer's view empties the pin (slices 3, 5)

- [ ] As **Owner**, unshare the "Over 30" view from the member. Leave their station access in place.
- [ ] As **Sharee**, reload "Smoke 640 table". It shows the **"This pin's data isn't available."** notice, and `GET …/data` → `422`.
- [ ] As **Definer** (member), open the pin. It shows the access-lost warning, because the definer sees the reason.
- [ ] Share the view with the member again. The pin repopulates with b, c, d, e on the next load.

## §7 — Results that can't be re-run can't be pinned (slices 5, 6)

- [ ] **Chat gate (— manual: prepare the state by hand).**
  - Prepare: in `psql`, remove `sql`, `pipeline` and `queryHandle` from one table block in a portal message's stored blocks. Then reload the portal.
  - Expected: that block's Pin button is **disabled**, and its tooltip reads **"This result can't be re-run, so it can't be pinned."**
- [ ] **Server refusal (— backend).**
  - Command: `POST /api/portal-results` with a `data-table` block whose content is `{ "columns": ["a"], "rows": [{"a":1}] }` (no `sql`, `pipeline` or handle).
  - Expected: **422 `PORTAL_RESULT_NOT_REEXECUTABLE`**, and no row is inserted.
- [ ] **Legacy pin.**
  - Prepare: `update portal_results set content = '{"columns":["email"]}' where name='Smoke 640 chart'`, and set its `type` to `data-table` if needed. **— backend**
  - Expected: opening it shows the warning **"This pin can't refresh — re-pin it from a new result."** (`pinned-not-reexecutable`).
- [ ] The **Refresh** endpoint is gone: `curl -X POST … /api/portal-results/<id>/refresh` → `404`. **— backend**

## §8 — Migration stripped every stored snapshot (slice 6)

- [ ] Check every remaining data pin. **— backend**
  - Query: `select count(*) from portal_results where type in ('data-table','d3','geo') and (content ?| array['rows','samplePeek','rowCount','matchedCount','queryHandle','schema','truncated'])`
  - Expected: `0`. This includes soft-deleted rows and the pins recorded in Preflight.
- [ ] Text pins are unchanged: their `content` is still the original string. **— backend**
- [ ] Pins that existed before the migration either render live (they still had a `pipeline`) or show the "can't refresh" notice. None shows old rows.

## §9 — Viewing pins is never charged (slice 3)

- [ ] As Owner, note the **Subscription & Usage** values on **Settings → Organization** (or the `usage` table row for the org and current period).
- [ ] Open, reload and page each pin from this suite about 10 times, including map tiles.
- [ ] Usage is unchanged, and no tool-usage error appears. **— backend** for the table
- [ ] The `/data` route draws on the per-org viz-refresh window rather than tool credits. Past `VIZ_REFRESH_RATE_PER_MIN`, it answers `429`, and normal use doesn't reach that. Probing the limit belongs in the adversarial suite.

## §10 — Help copy (slice 7)

- [ ] Open **Help → Glossary → "Pinned Result"**. It describes live data shown with the pinner's access, and doesn't mention a saved snapshot.
- [ ] Open **Help → FAQ**. The entry **"What do people see when I share a pinned result?"** is present. Neither the save-a-result answer nor the refresh answer says pins store a copy of the rows.

---

## Sign-off

- [ ] Every section above verified (or its unverified steps carry a recorded reason)
- [ ] <date + name>, confirmed against my own running stack

## Bug-filing template

Section: · Identity (owner/admin/member): · Expected: · Got: · Repro: · Identifiers (org / station / pin / view ids, HTTP code + `code`):
