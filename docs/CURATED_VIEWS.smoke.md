# curated-views — Smoke Suite

Manual smoke test for [#599](https://github.com/EnterpriseBT/portal-ai/issues/599) — curated views: per-user view-scoped data exposure (schema, session engine, sharing/composition, the Views UI, and RBAC-gated raw REST). **Branch under test:** `feat/599-curated-views` (PR [#642](https://github.com/EnterpriseBT/portal-ai/pull/642)).

**Tags:** steps are `— agent` (walkable by `/smoke-walk` in a browser), `— backend` (a `db:studio`/API check the human runs), or `— manual` (human judgment / agent-chat interpretation). Every box scaffolds **unchecked** — the agent produces evidence; **you** confirm and check.

## Preflight

### Environment

- [ ] `git checkout feat/599-curated-views && git pull --ff-only`
- [ ] `npm install`
- [ ] **Migrate** — `cd apps/api && npm run db:migrate` (this branch adds `0113`–`0116`: the three curated-view tables + cutover backfill, the `in_curated_view` condition + `condition_param`, `where_clause`→`filter jsonb`, and the member `page:views` grant). `predev` runs `db:seed`, **not** `db:migrate` (`project_dev_seeds_not_migrates`) — migrate explicitly first.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)
- [ ] `npm run --workspace @portalai/e2e e2e:auth` (refresh the git-ignored `storageState`) — required for `/smoke-walk`

### Fixtures

- [ ] A seeded org with **two roles** — an **admin/owner** (holds `AdminAccess *`) and a plain **member** (`MemberAccess`) — reachable via the `@portalai/e2e` fixture (`e2e:use <role>`, `project_smoke_walk_identity_switch`). The e2e org already has `customRbac` (`project_e2e_customrbac_vs_toolpack`).
- [ ] At least one connector **entity with data** (the walkthrough calls it `accounts`; any seeded wide-table entity works) that has a text column suitable for a region-style filter (e.g. a `region`/`status` column) and ≥2 columns so column-scoping is observable.

### Reset between runs

- [ ] Views/grants created here are soft-deletable via the Views page (delete) + the ShareDialog (revoke). To fully reset: `db:studio` and soft-delete the `curated_views` / `station_views` / `permission_grants` rows you created, or re-seed the e2e org (`e2e:seed`).

## §1 — Migration & cutover (AC6)

- [ ] **— backend** After `db:migrate`, in `db:studio`: the `curated_views` table has **one default (unrestricted) view per previously-attached entity** (null `filter`, no `curated_view_field_mappings` rows), and a matching `station_views` row per (station, entity). Expected: exactly the pre-existing `station_instances`→entity pairs, **no `permission_grants` rows** created (default-deny).
- [ ] **— backend** `station_instances` is **untouched** (still present) — it remains the connector-management capability; the read path no longer reads it.
- [ ] **— manual** As the **member**, open a station's portal/agent that previously showed data: with no view shared to them yet, the agent session is **empty** (no queryable entities). This is the intended cutover default-deny.

## §2 — Views admin page + editor (AC1 UI, AC3, + diff surfaces)

- [ ] **— agent** As **admin**, the sidebar shows a **Views** nav item with the **Layers** icon (distinct from Column Definitions' `ViewColumn`); clicking it lands on `/views` **with the sidebar + app header present** (regression: the page had no layout).
- [ ] **— agent** The Views page renders the standard **breadcrumb (Dashboard / Views) → header → PaginationToolbar → DataTable** (columns Name / Key / Row filter / Description / Created / Actions), **no subheader description**.
- [ ] **— agent** Click **Create View**: the dialog lets you pick an entity, a **key** + label, a **field-mapping projection** picker (empty = all columns), and the **AdvancedFilterBuilder** for the row filter. Create `ne_accounts` = the `accounts` entity, projection = 2 columns, filter `region = "NE"`. Expected: 201, the view appears in the table.
- [ ] **— agent** Create a second view `sw_accounts` over the **same** `accounts` entity, filter `region = "SW"` (two independent views over one wide table — AC1).
- [ ] **— agent** Open a view's **detail** page (`/views/:id`): header, tags/edit/delete, and a **records table** showing only the projected columns, filtered rows. The icon is **Layers** here too (uniform).
- [ ] **— manual (AC3)** As a **member** who was granted `ne_accounts` (§3) but does **not** independently hold a field mapping outside its projection, attempt (via the editor, if reachable, or the API) to add that field mapping to a view's projection. Expected: **403 `CURATED_VIEW_FIELD_NOT_READABLE`** — you can't project a field you can't read. Attribute edits (label/desc/filter) are allowed; projection edits are the gated tier.

## §3 — Sharing & composition (AC1, AC2)

- [ ] **— agent** As **admin**, on the Views list, use a view card/row **Share** action → the ShareDialog opens for that `curated_view`. Share `ne_accounts` with the **member** (or "the team"). Expected: success.
- [ ] **— agent** As **admin**, share a **station** (its ShareDialog): the dialog surfaces the station's **attached views as a reviewable checkbox list with a "Select all" control** (indeterminate state, preselect-all, deselectable). Confirm with a subset selected. Expected: the station is shared **and** one independent `curated_view` share per selected view (revocable individually).
- [ ] **— backend (AC2 composition)** In `db:studio`, after sharing `ne_accounts` with the member: `permission_grants` has **both** a `read curated_view:<ne_id>` row **and** a composed `read field_mapping` row with `condition='in_curated_view'`, `condition_param=<ne_id>`, `resource_id=null` for the member principal.
- [ ] **— backend (AC2 deny)** Add an explicit `deny read curated_view:<ne_id>` (or `deny read field_mapping:<one projected id>`, or class-level `deny read entity_record`) for the member. Expected in §4: the denied slice/column/rows disappear **even though the view is shared** (deny overrides allow).
- [ ] **— agent** Revoke the `ne_accounts` share (ShareDialog): expected the view grant **and** the composed field grant are both removed (no orphaned field grant).

## §4 — Agent session view-scoping (AC1, AC4, AC5)

Run as the **member** (switch role via `e2e:use member`, close + re-navigate — `project_smoke_walk_identity_switch`).

- [ ] **— manual** In the station's portal/agent, ask: **"what data can I query here?"** Expected: the roster / `station_context` lists **only** `ne_accounts` (the granted view) — **not** `sw_accounts` (unshared) and **not** the raw `accounts` entity. AC1: identical scoping across the roster, `_meta_*`, and `station_context`.
- [ ] **— manual** Ask the agent: **"show me ne_accounts"** / a SQL query over it. Expected: rows filtered to `region = NE` and only the projected columns — no SW rows, no unprojected columns.
- [ ] **— manual (AC2 deny)** With the §3 explicit `deny` in place, repeat: the denied column/rows are **gone even though the view is shared**.
- [ ] **— manual** Ask the agent to query **`sw_accounts`** (unshared): expected the agent cannot find it (not in the session).
- [ ] **— manual (AC5)** Ask the agent to **update/delete a record not in `ne_accounts`** (e.g. an SW row): expected the agent cannot target it (the view hides it) and/or the write is refused by the #629 per-caller gate — a member cannot mutate via the agent what they can't see in the UI.
- [ ] **— manual (AC4)** As **admin** on a station with **no attached-and-granted views**, the agent session is **empty**; attach + grant a view → it appears. Capability/context/roster/`station_context` all derive from `station_views`, not `station_instances`.

## §5 — Raw REST is RBAC-gated (slice 8 + the IDOR fix)

- [ ] **— backend** As the **member** (member bearer token), `GET /api/connector-entities/<accounts_entity_id>/records`. Expected: **only records the member created** (≈none for synced data — `entity_record.createdBy` is the syncing actor) — **not** the full raw table. The curated-views bypass is closed. As **admin**: full rows.
- [ ] **— backend** As the **member**, `PATCH`/`DELETE` a synced record via the API. Expected: **403** (RBAC `check` on `entity_record`), even though the connector has write capability.
- [ ] **— backend (cross-tenant IDOR)** As an org-A user, `GET /api/connector-entities/<org-B entity id>/records`. Expected: **404 `CONNECTOR_ENTITY_NOT_FOUND`** (org-scoped at entity resolution — no cross-tenant read).

## §6 — Filter render (AC filter + injection safety)

- [ ] **— manual/agent** The `ne_accounts` filter (`region = NE`) restricts rows in both the detail records table (§2) and the agent session (§4) — confirms `renderFilterGroupToSql` applies.
- [ ] **— backend** Create a view whose filter value contains a quote / SQL fragment (e.g. `region = "x' OR '1'='1"`). Expected: the value is **escaped** (`'x'' OR ''1''=''1'`), the view materializes safely, and it matches **zero** rows — not an injection. (No raw SQL path exists in #599; #644.)

## §7 — Error & edge cases (Risks)

- [ ] **— backend/agent** Create a view with a **reserved key** (`_meta_columns`, `_record_id`, `source_id`, or a >63-char key). Expected: **400** (`CURATED_VIEW_INVALID_PAYLOAD`) — the key can't collide with the `_meta_*` introspection views.
- [ ] **— backend** `POST /api/curated-views/<id>/attach` with a **cross-org / nonexistent** `stationId`. Expected: **404** (no dangling `station_views` row).
- [ ] **— backend** Duplicate `(org, key)` on create → **409**; an invalid `filter` → **400**.
- [ ] **— agent** Delete a view (Views page): expected it disappears from the list, its `station_views` + `curated_view_field_mappings` + grants (incl. the composed field grants) are cascaded.

## Sign-off

- [ ] Every section above verified
- [ ] _____ (date + name) — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org / station / view / entity / grant ids):
