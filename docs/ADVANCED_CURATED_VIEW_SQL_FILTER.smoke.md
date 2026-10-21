# advanced-curated-view-sql-filter — Smoke Suite

Manual smoke test for [#644](https://github.com/EnterpriseBT/portal-ai/issues/644): the opt-in **SQL row filter** on curated views. It covers:
- authoring (Builder | SQL mode, Suggest, Preview);
- the save-time validator and dry-run;
- the `advancedViewFilters` entitlement (pro, enterprise) with its upsell and downgrade behaviour;
- column pinning;
- reading every curated view through the restricted reader role: the records list, identity lookup and agent session.

**Branch under test:** `feat/644-advanced-curated-view-sql-filter` (PR [#841](https://github.com/EnterpriseBT/portal-ai/pull/841)).

Run **§Preflight** once. After it, each section is independent.

Steps carry one of three tags:
- **Untagged:** agent-walkable via `/smoke-walk`.
- **`— manual`:** needs a human (a file upload, a visual judgment, a restart with changed env).
- **`— backend`:** a psql or curl check against the running stack.

The agent never checks a box. You confirm.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, type `Bug`, linking the section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/644-advanced-curated-view-sql-filter && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`. Core gained `filterSql` on the curated-view model and contracts, and `advancedViewFilters` on the tier model and catalog.
- [ ] `cd apps/api && npm run db:migrate && cd ../..`. Migration **`0130_add-curated-view-filter-sql-and-tier-entitlement`** adds `curated_views.filter_sql`, `filter_sql_keys` and the `curated_views_filter_mode_exclusive` CHECK, plus `tiers.advanced_view_filters`. (`npm run dev` seeds but doesn't migrate.)
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). The API log shows `portal-sql.reader-role-ok`, because every curated-view read now needs the reader role.
- [ ] `ANTHROPIC_API_KEY` is set in `apps/api/.env`. §6 Suggest calls Haiku 4.5.

### Fixtures

- [ ] Converge the tier catalog: `npx portalops tier apply --env local`. The diff lists `advancedViewFilters: false → true` for **pro** and **enterprise**. (Rebuild the CLI first if `dist/` is stale: `npm run build --workspace @portalai/devops-cli`.)
- [ ] Put the fixture org on pro: `npx portalai org list --env local --json`, find `e2e-fixture`'s id, then `npx portalai org set-tier <id> pro --env local --yes`. Wait up to 60s for the tier cache.
- [ ] e2e identities and org: `npm run --workspace @portalai/e2e e2e:auth` (plus `:admin` and `:member` if expired), then `e2e:seed`. The owner walks unless a step names another role.
- [ ] The fixture's demo entities exist: **Sites** (`name`, `type`, `latitude`, `longitude`; one site per demo city) and **Cash Flows** (`month`, `inflow`, `outflow`, `net`).
- [ ] **JSON fixture — manual.** Connectors → Catalog → File upload. Upload `assets.json`:

  ```json
  [{"asset_id":"a1","meta":{"status":"active","owner":"ops"}},
   {"asset_id":"a2","meta":{"status":"retired","owner":"ops"}},
   {"asset_id":"a3","meta":{"status":"active","owner":"finance"}}]
  ```

  Map `meta` to a **JSON** column definition, key `meta`. The entity is **Assets**.

### Reset between runs

- [ ] Delete the views this walk creates: `near_seattle`, `cash_positive`, `texas_sites`, `active_assets`, `builder_regression`, `pinned_addr`.
- [ ] Put the org back: `npx portalai org set-tier <id> standard --env local --yes` (or leave it on pro).

---

## §1 — The builder path is unchanged

- [ ] Views → **Create View** → entity **Sites**, label "Builder regression", key `builder_regression`. The Row filter shows **Builder** pressed and the usual filter builder. Add `type = <any type>`, then Save.
- [ ] The view page's records table shows only that type, with the total count, column sort, search and paging (next and last page) working as before.
- [ ] Open an existing pre-branch view (any view in the fixture). Its records, sort and paging still work, and nothing on the page mentions SQL.

## §2 — SQL mode and its entitlement

- [ ] Create View → the Row filter header shows **Builder** and **SQL**. Click **SQL**. The builder is replaced by:
  - a "Describe the rows you want" field and a **Suggest** button;
  - a monospace **SQL filter** field (required);
  - a "Columns: …" line listing the entity's keys;
  - **Run preview**.
- [ ] Switch to Builder and back to SQL. Each mode keeps its own draft.
- [ ] **Not entitled — upsell.** `npx portalai org set-tier <id> standard --env local --yes`, wait 60s, reload, then open Create View.
  - The **SQL** button shows a lock icon and the tooltip "SQL filters are available on a higher plan."
  - Clicking it goes to **Settings → Billing**, not into SQL mode.
- [ ] **Not entitled — API refusal — backend.** With the org still on standard, POST `/api/curated-views` with `{"connectorEntityId":"<sites id>","key":"x","label":"x","filterSql":"latitude > 0"}` using the owner's token (DevTools → copy a request's Bearer). The response is **403 `CURATED_VIEW_FILTER_SQL_NOT_ENTITLED`**. Then set the tier back to **pro** and wait 60s.

## §3 — Saving SQL filters (spatial, column-vs-column, JSON path)

- [ ] **Spatial.** Create View → Sites, label "Near Seattle", key `near_seattle`, SQL mode. Filter:
  `ST_DWithin(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), ST_SetSRID(ST_MakePoint(-122.33, 47.61), 4326), 3)`
  Save. The view's records table lists **only the Seattle and Portland sites**: Portland is about 2.1° away, San Francisco about 10°.
- [ ] **Column-vs-column.** Create View → Cash Flows, key `cash_positive`, SQL filter `inflow > outflow`. Save. Every row in the records table has `inflow > outflow`. (Every demo row qualifies, so the total equals the entity's 30.)
- [ ] **Column-vs-column narrows.** In the editor, Run preview on `inflow > outflow * 1.3`. The row count matches `select count(*) from "er__<cash_flows id>" where deleted is null and c_inflow > c_outflow * 1.3` (7 on the demo data), below 30.
- [ ] **JSON path — manual (needs the Assets fixture).** Create View → Assets, key `active_assets`, SQL filter `meta->>'status' = 'active'`. Save. The records show **a1 and a3** only.
- [ ] Re-open `near_seattle` (Edit). It opens in **SQL** mode with the stored filter text. Change only the label and Save: the view is renamed and its rows are unchanged.
- [ ] **Stored state — backend.** `psql`: `select key, filter, filter_sql, filter_sql_keys from curated_views where key in ('near_seattle','cash_positive');` Expect:
  - `filter` is null;
  - `filter_sql` is as typed;
  - `filter_sql_keys` is `{latitude,longitude}` and `{inflow,outflow}` respectively.
- [ ] **Mode switch clears the other mode.** Edit `cash_positive` → Builder → add `net > 0` → Save. The psql row now has `filter` set, `filter_sql` null and `filter_sql_keys` `{}`. Switch it back to SQL `inflow > outflow` and Save.

## §4 — The agent session and map read the filtered view

- [ ] Attach `near_seattle` and `cash_positive` to the fixture station (station page → attach view). Open a **New Portal**.
- [ ] Prompt: **"List the names of every site in near_seattle."** The answer names only the Seattle and Portland sites. The tool-call panel shows `sql_query` against `near_seattle`.
- [ ] Prompt: **"How many rows does cash_positive have?"** The count matches §3's records total.
- [ ] Prompt: **"Show near_seattle on a map."** — manual (visual). The map shows exactly two points, near Seattle and Portland.

## §5 — A view reader sees the rows, not the filter

- [ ] As the owner, share `near_seattle` read with the **member** (view page → Share → the e2e member). Switch identity: `npm run --workspace @portalai/e2e e2e:use member`, then restart the MCP session.
- [ ] As the member, open `near_seattle`:
  - the records are the same two sites;
  - the page shows the view as **Filtered**;
  - there's no Edit action;
  - no filter text appears anywhere on the page.
- [ ] **Member payload — backend.** GET `/api/curated-views/<near_seattle id>` with the member's token. The response has `"filter": null`, `"filterSql": null`, `"filterSqlKeys": []` and `"filtered": true`, and the body doesn't contain `ST_DWithin`.
- [ ] Switch back: `e2e:use owner`, then restart the MCP session.

## §6 — Preview and Suggest

- [ ] **Rows.** Create View → Sites → SQL. Type `latitude > 40` and click **Run preview**. A "Running the filter…" spinner appears, then a table of the matching sites (only cities above 40°N) and a caption like "N matching rows." No total count is shown anywhere.
- [ ] **Stale preview.** Edit one character of the SQL. The preview table disappears, so the old rows don't sit next to new text.
- [ ] **Empty.** `latitude > 89` → Run preview shows "No rows match this filter."
- [ ] **Error.** `latitude + 1` → Run preview shows an error alert containing "argument of WHERE must be type boolean", with the code `CURATED_VIEW_INVALID_FILTER_SQL`.
- [ ] **Suggest.** Prompt "sites in Texas". The button shows "Suggesting…". Then the SQL field fills with a filter over `latitude`/`longitude`, or `name`/`street_address`, and the preview runs on its own and lists only Texas sites (Dallas, Houston …). Saving keeps that text.
- [ ] **Suggester failure — manual.** Set `ANTHROPIC_BASE_URL=http://127.0.0.1:9` in `apps/api/.env`, then touch an API source file so nodemon restarts. Click Suggest:
  - an alert reads "Couldn't suggest a filter: the suggestion service didn't respond. You can still write one by hand." (`CURATED_VIEW_FILTER_SUGGEST_FAILED`);
  - typing a filter and saving still works.

  Remove the env line afterwards and restart.
- [ ] **Preview timeout — manual / accepted.** The 30s statement timeout can't be triggered from the editor: the validator refuses `pg_sleep` and similar functions. It's the same `openSqlSession` timeout every SQL session uses. Record the decision: accept this as covered, or note what you checked instead.

## §7 — Refused at save

For each filter below, open Create View → Sites → SQL, type the filter and click **Save**. The dialog stays open with a red alert, code `CURATED_VIEW_INVALID_FILTER_SQL`, whose message contains the given text. No view is created.

- [ ] `latitude > 0) OR (TRUE` → "single condition"
- [ ] `EXISTS (SELECT 1 FROM organizations)` → "subqueries are not allowed"
- [ ] `organizations.id = 'x'` → "column reference not allowed: organizations.id"
- [ ] `salary > 1` → "unknown column: salary"
- [ ] `pg_sleep(5) IS NULL` → "function not allowed: pg_sleep"
- [ ] `count(latitude) > 1` → "aggregate functions are not allowed"
- [ ] `latitude::regclass IS NULL` → "cast not allowed: regclass"
- [ ] `latitude > 0; DELETE FROM curated_views` → "syntax error" or "exactly one statement"
- [ ] `latitude + 1` → "argument of WHERE must be type boolean" (the dry-run)
- [ ] Empty SQL field + Save → the field turns red with "Filter is required" and no request is sent.

## §8 — Columns a SQL filter reads are pinned

Use `street_address`, which no other view in this walk references (`near_seattle` and the Texas view both pin `latitude`, so a pin on it never releases here).

- [ ] Create View → Sites, key `pinned_addr`, SQL `street_address IS NOT NULL`, Save.
- [ ] Open the Sites entity's fields and try to **rename** the `street_address` key. Refused with **409 `FIELD_MAPPING_KEY_IN_VIEW`**, and the key is unchanged.
- [ ] Try to **delete** the `street_address` mapping. It's refused. With records present the first refusal is `FIELD_MAPPING_DELETE_HAS_RECORDS`. **Backend:** `curl -X DELETE` on the mapping after soft-deleting the entity's records in psql (inside a transaction you roll back) returns **409 `FIELD_MAPPING_DELETE_IN_VIEW`**.
- [ ] Delete the `pinned_addr` view. The rename now succeeds; rename it back.

## §9 — Downgrade

- [ ] `npx portalai org set-tier <id> standard --env local --yes`, wait 60s, reload.
- [ ] `near_seattle`'s records still list the two sites. The view keeps resolving.
- [ ] Edit `near_seattle`:
  - it opens in SQL mode with the filter **read-only**;
  - an info alert reads "Your plan no longer includes SQL filters…";
  - there's no Suggest.
- [ ] Rename the view and Save: it succeeds.
- [ ] Switch to **Builder**, add `type = <any>` and Save. It succeeds, because leaving SQL mode needs no entitlement.
- [ ] Set the tier back to pro and wait 60s.

## §10 — The role boundary and broken filters — backend

These write `filter_sql` straight to the DB, **past the validator**, to prove the reader role and the fail-closed paths alone.

- [ ] Run `update curated_views set filter_sql = 'salary > 1', filter_sql_keys = '{salary}' where key = 'cash_positive';`. Then:
  - GET `/api/curated-views/<id>/records` returns **409 `CURATED_VIEW_FILTER_SQL_BROKEN`**;
  - in a portal, `SELECT count(*) FROM cash_positive` returns **0**, never the unfiltered count;
  - the API log has `curated view filter_sql failed to render; serving it empty`.
- [ ] On a **Sites** view (e.g. `texas_sites`; set `filter = null` too), set `filter_sql = 'name::int > 5'`, `filter_sql_keys = '{name}'`. It creates fine but fails on the rows ("Seattle warehouse" isn't an integer). Records return **409** with the message "This view's filter fails on some of its rows…", and the response names no cell value. (A cast that is invalid for the column's type, like `month::int` on a date, fails at create time instead: that's the previous step's 409.) Restore the view's filter afterwards.
- [ ] Set `filter_sql = 'EXISTS (SELECT 1 FROM organizations)'`. Records return 409, and the API log shows the render refusal. The validator re-runs on every render, so the fragment never reaches Postgres.
- [ ] Restore it: `update curated_views set filter_sql = 'inflow > outflow', filter_sql_keys = '{inflow,outflow}' where key = 'cash_positive';`. Records come back.

## Sign-off

- [ ] Every section above verified
- [ ] `<date + name>` — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro (exact filter text / clicks): · Identifiers (org id, view id, entity id, request id from the API log):
