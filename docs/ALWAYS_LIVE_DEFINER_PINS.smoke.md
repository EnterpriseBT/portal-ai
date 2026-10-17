# always-live-definer-pins — Smoke Suite

Manual smoke test for [#640](https://github.com/EnterpriseBT/portal-ai/issues/640). After this change, a data pin (table, chart or map) stores only its query and how to draw it, never rows. Each time someone opens it, the query runs live with the access of the person who pinned it (the definer). If the definer loses that access, the pin goes empty. **Branch under test:** `feat/640-always-live-definer-pins` (PR [#819](https://github.com/EnterpriseBT/portal-ai/pull/819)).

Run **§Preflight** once. Every later section starts from the §0 fixture and doesn't depend on the others, with two exceptions: §5 removes a definer, and §6 revokes one's view. Run those two last, or re-run §Reset between them.

Step tags:
- *(none)*: the agent can walk the step in a browser with `/smoke-walk`.
- **— backend**: check it with `curl` or `psql`.
- **— manual**: needs a person's judgment or a hand-prepared state.

**Identities** (the seeded `e2e-fixture` org, #620). The suite needs both a *read-only* viewer and a viewer with *broader* data access than the definer. No single identity is both, so the definer and viewer swap between sections:

| Alias | Who | What they can do here |
|---|---|---|
| **Owner** | `E2E_AUTH0_USERNAME` (qa@…) | Builds the fixture. Manages every pin, so sees the **reason** when a pin fails |
| **Member** | the e2e **member** | Reads data only through the views shared with it. On pins it holds only what is shared with it, so it's the **read-only** viewer |
| **Admin** | the e2e **admin** | Reads every view, so its data access is broader than the member's. Its role also grants `read/write/delete/share` on **every pin**, so it's a pin **manager**, not a read-only viewer: unsharing never cuts it off, and it sees the reason, not the neutral message |

Who plays which part:

| Section | Definer | Viewer |
|---|---|---|
| §1, §2, §4, §6 | member | admin |
| §3 unshare, §5 | admin | member |

To switch identity: `npm run --workspace @portalai/e2e e2e:use <owner|admin|member>`, then close the browser and navigate again. Copy `.auth/storageState.json` to `.auth/owner.storageState.json` first, so you can switch back to owner. The admin and member land in their personal orgs by default; switch them into `e2e-fixture` in-app, or with `POST /api/organization/switch {"organizationId": …}`. For `curl`, the bearer is the `access_token` inside each `.auth/<role>.storageState.json`.

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
- [ ] `e2e-fixture` is on the `standard` plan, which excludes the GIS toolpack. Move it to `pro` for the suite: `npx portalai org set-tier <e2e-fixture id> pro --env local --yes`. The tier cache takes up to 60s to pick this up. Restore it with `… standard` at the end.

### Fixtures (§0, as Owner)

- [ ] The REST API connector **"Smoke 640 ArcGIS USA"**. It reads the public, token-free Esri sample server `https://sampleserver6.arcgisonline.com/arcgis/rest/services/USA/MapServer` and has two entities:
  - `usa_states` (`/2/query`, id `state_abbr`): 51 polygons with `state_name`, `sub_region` and population columns.
  - `usa_cities` (`/0/query`, id `objectid`): 3,557 points, paged 1,000 at a time with `resultOffset` / `resultRecordCount`. Map `class` to **Text**, not the probe's Enum: the sample has 2 values but the layer has 9.
  - Both endpoints use query params `where=1=1`, an `outFields` list, `returnGeometry=true`, `outSR=4326` and `f=json` (plus `orderByFields=objectid` for cities).
  - Both use the transform `[features.$merge([attributes, {"shape": geometry}])]`, which produces a `c_shape` geometry column (EPSG:4326).
  - The first sync gives 3,608 records, all valid. If the connector is missing, create it through **Connectors → Catalog → REST API**.
- [ ] Create a station **"Smoke 640 Map"** with the connector and the `data_query`, `gis` and `visualize` toolpacks. Create these curated views and attach them to the station:
  - **"Pacific states"** (`key: pacific_states`): `usa_states` filtered to `sub_region = pacific` (stored in lowercase). That gives 5 states: Hawaii, Washington, Oregon, California, Alaska.
  - **"Cities"** (`key: cities`): all of `usa_cities`.
- [ ] Share the station, "Pacific states" and "Cities" with the **member** (Read). Share nothing with the admin: its own role already reads all 51 states, which §2 and §4 rely on.

### Reset between runs

- [ ] Re-run `e2e:seed`. It's convergent, so it restores the admin's membership after §5. Then switch the admin back into `e2e-fixture`.
- [ ] Share "Pacific states" with the member again after §6.
- [ ] Soft-delete this suite's pins: `update portal_results set deleted = (extract(epoch from now())*1000)::bigint, deleted_by='SMOKE640' where name like 'Smoke 640%'`. **— backend**
- [ ] Restore the plan: `npx portalai org set-tier <e2e-fixture id> standard --env local --yes`.

---

## §1 — A pin stores a recipe, never rows (slices 1, 6)

- [ ] As **Member**, open a portal on "Smoke 640 Map" and prompt: **"Show state_name, state_abbr and population_2000 for every row of the pacific_states view as a table."** A table renders with the **5 Pacific states**.
  - The agent may also return a short preview table, such as one ending in `LIMIT 3`. Pin the full one.
  - Each block's Pin button sits **after** that block.
- [ ] Pin the table as **"Smoke 640 table"**.
- [ ] Inspect the row in `psql`: **— backend**
  - Query: `select type, definer_principal_type, definer_principal_id, content->'pipeline'->>'sql', (select string_agg(k, ',') from jsonb_object_keys(content) k) from portal_results where name='Smoke 640 table'`
  - Expected: `definer_principal_type = user`, and `definer_principal_id` is the member's user id.
  - The content keys are **only** `columns` and `pipeline`. There is no `rows`, `samplePeek`, `rowCount`, `queryHandle` or `schema`.
- [ ] Prompt: **"Chart population_2000 per state from the pacific_states view as a bar chart."** Pin the chart as **"Smoke 640 chart"**. Its content keys are a subset of `program, title, params, pipeline`. **— backend**
- [ ] The `portal_results` table has no `snapshot_updated_at` column: `\d portal_results`. **— backend**

## §2 — A viewer sees the definer's data, live (slices 3, 5)

- [ ] As **Member**, open **Pinned results** (`/portal-results`). Its own cards show **no** "Data as … sees it" caption (`data-testid="pinned-result-definer"`).
- [ ] As **Member**, open "Smoke 640 table", then **More actions → Share** with the admin (Read). Share "Smoke 640 chart" the same way.
- [ ] As **Admin**, open `/portal-results`. Both cards carry the caption **"Data as e2e-member@portalsai.io sees it"**. The member has no display name, so the email is shown.
- [ ] Open "Smoke 640 table":
  - It shows exactly the **5 Pacific states**: the definer's rows, **not** the admin's own 51.
  - The metadata row reads **"Data — As e2e-member@portalsai.io sees it"**.
  - The network tab shows `GET /api/portal-results/<id>/data` → `200`, and **no** `POST …/refresh`.
- [ ] **Live:** as Owner, change the "Pacific states" filter to `sub_region = mtn`. As **Admin**, do a **full page reload**. The pin now shows the **8 Mountain states** (Montana, Wyoming, Nevada, Idaho, Utah, Colorado, Arizona, New Mexico).
  - Navigating away and back inside the app is not enough. The pin's data query stays cached for its 3-minute freshness window, so in-app navigation within that window reuses it.
- [ ] Put the filter back to `sub_region = pacific`.
- [ ] As **Admin**, open "Smoke 640 chart". It draws **5 bars**: California, Washington, Oregon, Hawaii, Alaska (about 33.9M down to 0.6M). It is not an empty 0–1 axis.
- [ ] Press the chart's **Refresh** button. It redraws the same 5 bars and does not go blank.

## §3 — Large pins page for a viewer (slices 2, 3)

- [ ] As **Member**, prompt: **"Show areaname, st and pop2000 for every row of the cities view as a table."** At 3,557 rows the result comes back as a query handle. Pin it as **"Smoke 640 cities"** and share it with the admin.
- [ ] As **Admin**, open the pin and press **Next page**. It shows "11–20 of 3557", and the network shows `GET /api/portal-sql/handle/<h>?offset=0&limit=5000` → `200`. The table loads 5,000 rows at once, so paging after that is client-side.
- [ ] **Unshare stops it.** Use an **admin**-defined pin here, because the admin can read every pin and so is never cut off by an unshare.
  - Setup: as Admin, pin the same cities table as **"Smoke 640 admin cities"** and share it with the **member**.
  - As Member: `GET …/data` returns a handle, and `curl -H "Authorization: Bearer $MEMBER" ':3001/api/portal-sql/handle/<h>?offset=10&limit=3'` → `200`. **— backend**
  - As Admin, revoke the member's share.
  - The same handle request → **404 `READ_HANDLE_EXPIRED`**, and `GET …/data` → **404**. **— backend**

## §4 — Map pins render the definer's data for everyone (slice 4)

- [ ] As **Member**, prompt: **"Map the pacific_states view, colored by population_2000."** The map shows 5 states. Pin it as **"Smoke 640 map"** and share it with the admin.
- [ ] As **Member**, prompt: **"Map all cities from the cities view as points."** The pin's content has `tiled: true`. Pin it as **"Smoke 640 cities map"** and share it with the admin.
- [ ] Fetch the **Pacific map's** tile `4/2/5` as member and as admin. It covers WA and OR, but also ID, MT and NV. **— backend**
  - Command: `curl -s -o /tmp/<role>.mvt -w '%{http_code}\n' -H "Authorization: Bearer $T" :3001/api/portal-map/tiles/pin/<pinId>/4/2/5.mvt`
  - Expected: both get `200` with **byte-identical** bodies (`cmp`). They hold 4 features with `c_population_2000` 626932 / 33871648 / 3421399 / 5894121 (AK, CA, OR, WA). There are **no Mountain states**, though the admin can read them.
- [ ] As **Admin**, open "Smoke 640 map". It shows the same 5 Pacific states, not all 51. **— manual** (visual comparison)
- [ ] The cities map's tile ETag changes on its own within about 3 minutes, so it isn't stuck on stale data. Compare the `ETag` header from two fetches more than 3 minutes apart. **— backend**

## §5 — Removing the definer empties the pin (slices 1, 3, 5)

Definer = **admin**, read-only viewer = **member**.

- [ ] As **Admin**, pin the Pacific table as **"Smoke 640 admin table"** and the Pacific map as **"Smoke 640 admin map"**, and share both with the member. As **Member**, the table shows 5 rows labelled "As e2e-admin@portalsai.io sees it".
- [ ] Optional, to exercise the attachment cleanup: direct user policy attachments are only created by the seed, never through the API. Insert one by SQL for the admin in `e2e-fixture` (a `policy_attachments` row with `principal_type='user'`). **— backend**
- [ ] As **Owner**, open **Settings → Members** and remove the **admin** from `e2e-fixture`.
- [ ] As **Member**, open "Smoke 640 admin table":
  - The info notice reads **"This pin's data isn't available."** (`pinned-data-unavailable`).
  - No table renders.
  - **No** "As … sees it" row appears; the notice doesn't say whose access ended.
  - The network shows `GET …/data` → `422 PORTAL_RESULT_DATA_UNAVAILABLE`.
- [ ] As **Owner**, open the same pin. It shows the warning **"The person this pin's data is shown as no longer has access to it."** (`pinned-definer-access-lost`). The API code is `PORTAL_RESULT_DEFINER_ACCESS_LOST`.
- [ ] As **Member**, open "Smoke 640 admin map". It shows the unavailable state, and a tile `curl` returns `422`. **— backend** for the curl
- [ ] The admin's direct attachments in this org are soft-deleted. **— backend**
  - Query: `select count(*) from policy_attachments where principal_type='user' and principal_id='<admin id>' and organization_id='<e2e-fixture id>' and deleted is null`
  - Expected: `0`. Attachments in the admin's personal org are untouched.
- [ ] Re-seed (§Reset) and switch the admin back into the org. "Smoke 640 admin table" serves data again (`/data` → `200`).

## §6 — Revoking the definer's view empties the pin (slices 3, 5)

Definer = **member**.

- [ ] As **Owner**, unshare the "Pacific states" view from the member. Leave the station share in place.
- [ ] As **Member** (the definer), reload "Smoke 640 table". It shows **"You no longer have access to the data behind this pin."** and no table.
- [ ] As **Owner** or **Admin** (both managers), the same pin shows **"The person this pin's data is shown as no longer has access to it."** `GET …/data` → `422 PORTAL_RESULT_DEFINER_ACCESS_LOST`.
  - A read-only viewer would see the neutral notice, as in §5. No identity here is both read-only on this pin and someone other than its definer.
- [ ] "Smoke 640 map" tiles now return `204` (empty). The cities map's tiles still return `200`, since its view is still granted. **— backend**
- [ ] Share the view with the member again. The pin repopulates with the 5 Pacific states on the next full reload.

## §7 — Results that can't be re-run can't be pinned (slices 5, 6)

- [ ] **Chat gate (— manual: prepare the state by hand).**
  - Prepare: in `psql`, strip the query from one stored table block:
    `update portal_messages set blocks = jsonb_set(blocks, '{<i>,content}', (blocks-><i>->'content') - 'pipeline' - 'sql' - 'queryHandle') where id='<message id>'`
  - Then reload the portal.
  - Expected: that block's Pin button is **disabled** (`aria-disabled`), and its tooltip reads **"This result can't be re-run, so it can't be pinned."**
- [ ] **Server refusal (— backend).**
  - Command: `POST /api/portal-results {"portalId": …, "messageId": "<message id>", "blockIndex": <i>, "name": "Smoke 640 no-query"}` for that same block.
  - Expected: **422 `PORTAL_RESULT_NOT_REEXECUTABLE`**, and no row is inserted.
- [ ] **Legacy pin.**
  - Prepare: insert a `data-table` pin whose content is `{"columns":["c_state_name"]}` (no `pipeline`). This is what 0125 leaves of a pre-#640 pin that had no query. **— backend**
  - Expected: opening it shows **"This pin can't refresh — re-pin it from a new result."** (`pinned-not-reexecutable`) and no table.
- [ ] The **Refresh** endpoint is gone: `curl -X POST … /api/portal-results/<id>/refresh` → `404`. **— backend**

## §8 — Migration stripped every stored snapshot (slice 6)

- [ ] Check every remaining data pin. **— backend**
  - Query: `select count(*) from portal_results where type in ('data-table','d3','geo') and jsonb_typeof(content)='object' and (content ?| array['rows','samplePeek','rowCount','matchedCount','queryHandle','schema','truncated'])`
  - Expected: `0`. This includes soft-deleted rows and the pins recorded in Preflight.
- [ ] Text pins are unchanged: their `content` is still a string (`jsonb_typeof = string`). **— backend**
- [ ] Pins that existed before the migration either render live (they still had a `pipeline`) or show the "can't refresh" notice. None shows old rows. This needs pre-#640 pins in the DB; if Preflight recorded none, say so.

## §9 — Viewing pins is never charged (slice 3)

- [ ] As Owner, note the **Subscription & Usage** values on **Settings → Organization**, or the org's `usage` rows and its `tool_usage_ledger` count.
- [ ] Open, reload and page each pin from this suite about 10 times, including map tiles.
- [ ] Usage is unchanged, and no tool-usage error appears. **— backend** for the table
- [ ] The `/data` route draws on the per-org viz-refresh window rather than tool credits. Past `VIZ_REFRESH_RATE_PER_MIN`, it answers `429`, and normal use doesn't reach that. Probing the limit belongs in the adversarial suite.

## §10 — Help copy (slice 7)

- [ ] Open **Help → Glossary → "Pinned Result"** (`/help?tab=glossary#glossary-entry-pinned-result`). It describes live data shown with the pinner's access, and doesn't mention a saved snapshot.
- [ ] Open **Help → FAQ**. The entry **"What do people see when I share a pinned result?"** is present. Neither "How do I save results from a portal session?" nor the refresh answer says pins store a copy of the rows.

---

## Sign-off

- [ ] Every section above verified (or its unverified steps carry a recorded reason)
- [ ] <date + name>, confirmed against my own running stack

## Bug-filing template

Section: · Identity (owner/admin/member): · Expected: · Got: · Repro: · Identifiers (org / station / pin / view ids, HTTP code + `code`):
