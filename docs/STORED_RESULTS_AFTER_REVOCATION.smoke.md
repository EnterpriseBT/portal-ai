# stored-results-after-revocation — Smoke Suite

Manual smoke test for [#1038](https://github.com/EnterpriseBT/portal-ai/issues/1038). A portal answer no longer stores its rows: tables, charts and maps keep the query that re-runs them, and every render reads live under the reader's current access. Revoking a view, or detaching it from the station, now reaches results already shown. **Branch under test:** `fix/1038-stored-results-after-revocation` (PR [#1086](https://github.com/EnterpriseBT/portal-ai/pull/1086)).

Run **§Preflight** once. After that the sections can be walked in order: §2 and §3 change access and put it back.

**Step tags:** untagged steps are agent-walkable through `/smoke-walk`. `— manual` needs a human. `— backend` is an API, DB or CLI check with no UI.

For an API call, copy the `Authorization` header from any `/api/...` request in devtools as `$T`, signed in as the named user. For psql: `cd apps/api && set -a && . ./.env && set +a && psql "$DATABASE_URL"`.

---

## Preflight

### Environment

- [ ] `git checkout fix/1038-stored-results-after-revocation && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`. The block contracts changed, and the API and web read core's `dist`.
- [ ] `cd apps/api && npm run db:migrate`, which applies **0136 strip-stored-result-rows** (data only, no schema change). It prints `Migrations completed`.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). If it was already running, **restart the API**: it keeps the core it started with.

### Fixtures

- [ ] The `e2e-fixture` org (tier `enterprise`) with an **owner** and a **member** (`packages/e2e/README.md`). Switch identity with `npm run --workspace @portalai/e2e e2e:use <owner|member>`.
- [ ] **Member Lab** is the member's own station. It has `smoke_ne` and `smoke_all` attached, and the member holds a read grant on **`smoke_ne`** only. Check with `SELECT cv.key FROM permission_grants g JOIN curated_views cv ON cv.id = g.resource_id WHERE g.principal_id = '<member id>' AND g.deleted IS NULL;`
- [ ] As the member, open **Member Lab → Edit** and make sure its packs include **Data Query**, **Curated Views** and **Visualize**. Add Visualize if it's missing.

### Reset between runs

- [ ] As owner, re-share `smoke_ne` with the member (Views list → smoke_ne card → **Share**, **Can view**) if §2 left it revoked.
- [ ] As the member, re-attach `smoke_ne` to Member Lab if §3 left it detached.
- [ ] Delete the portals this walk created (portal list → Delete).

---

## §1 — A stored result draws live, with the time of that read

- [ ] As the **member**, open Member Lab → **Open Portal**, and send **"Show the records in smoke_ne."** A table renders during the turn (`display_entity_records`).
- [ ] Send **"Chart smoke_ne as a bar chart of record counts by any text column."** A chart renders (`visualize_d3`).
- [ ] **Reload** the portal page. Each table and chart shows a loading state first, then its rows. No stored rows paint before the read.
- [ ] In the Network tab, each widget made one `POST /api/portal-sql/widget-refresh` returning `200`. That includes the `display_entity_records` table, which answered `422 VIZ_WIDGET_NOT_REFRESHABLE` before this change.
- [ ] Each widget's "Updated …" note reads **"just now"**, the time of the read that drew it, not the message's age.
- [ ] While each turn finishes, no `widget-refresh` answers `404`: until the stored message replaces the turn's local copy, its widgets draw the live delivery and send no refresh, and they offer no pin.
- [ ] Within 3 minutes, go to the Dashboard and back to the portal. The widgets show their rows with **no new** `widget-refresh` request (the tab's read cache).
- [ ] After 3 minutes, do the same again. Each widget makes **one** new `widget-refresh` request.

## §2 — Revoking the view reaches results already shown

- [ ] From the reload in §1, copy a table's live `queryHandle` from a `widget-refresh` response (`payload.queryHandle`) or from a `/api/portal-sql/handle/<id>` request. Note it as `<qh>`. A small result has no handle; use the `smoke_ne` records table.
- [ ] Switch to the **owner**. On the **Views** list, open the **smoke_ne** card's **Share** action (the view's own page has none) and remove **e2e-member**. The share list no longer names them.
- [ ] Switch to the **member** and reload the portal. Every widget built on `smoke_ne` shows **"This result is no longer available to you."**, under its title. No row values from `smoke_ne` appear anywhere on the page.
- [ ] The Network tab shows `widget-refresh` answering `422` with code `VIZ_WIDGET_DATA_UNAVAILABLE`.
- [ ] As the member, call `curl -s localhost:3001/api/portal-sql/handle/<qh>?offset=0\&limit=5 -H "Authorization: Bearer $T"` — backend. Once 30 seconds have passed since the member's last read of that handle, it answers `404` with code `READ_HANDLE_EXPIRED`.
- [ ] `GET /api/portals/<portalId>` (the page's own request, in the Network tab) contains none of the table's row values. Each stored `data-table` / `d3` block's `content` has a `pipeline` and no `rows`, `samplePeek` or `queryHandle`.
- [ ] Restore access: as the owner, share `smoke_ne` with the member again from the Views list card's **Share** (**Can view**). As the member, reload. The widgets show their **current** rows again, with "Updated just now".

## §3 — Detaching the view from the station does the same

- [ ] As the **member**, open **Member Lab → Edit**, remove **smoke_ne** from Views, and **Save**.
- [ ] Reload the portal from §1. The `smoke_ne` widgets show **"This result is no longer available to you."**
- [ ] Re-attach `smoke_ne` (Edit → Views → add it → Save) and reload. The rows come back.

## §4 — Nothing stores rows (backend)

- [ ] After §1's turns, in psql: `SELECT count(*) FROM portal_messages WHERE blocks::text LIKE '%"samplePeek"%' OR blocks::text LIKE '%"rows":%';` returns **0** — backend.
- [ ] The latest assistant message's raw `tool-result` for `display_entity_records` is `{ "rowsNotKept": true, "columns": [...], "rowCount": N, "sql": "...", "queryHandle": "qh-..." }` and holds no row values: `SELECT blocks FROM portal_messages WHERE role = 'assistant' ORDER BY created DESC LIMIT 1;` — backend.

## §5 — Follow-ups re-query

- [ ] In the §1 portal, send **"What is the value in the first column of the first record you showed me?"** The tool-call panel shows a new query (a `sql_query` call, or a reuse of the earlier `queryHandle`). The answer isn't recited from memory, and it states a value that matches the table.

## §6 — A result with no recipe isn't kept (backend setup)

- [ ] In psql, add a block with no `pipeline` to the member's latest assistant message, standing in for a custom tool's table — backend:
  ```sql
  UPDATE portal_messages
  SET blocks = blocks || '[{"type":"data-table","content":{"type":"data-table","columns":["n"],"rows":[{"n":1}]}}]'::jsonb
  WHERE id = (SELECT id FROM portal_messages WHERE role = 'assistant' ORDER BY created DESC LIMIT 1);
  ```
- [ ] Reload the portal. That block reads **"This result isn't kept after the conversation. Ask again to see it."**, and the value `1` isn't shown.
- [ ] The block's pin action is disabled with "This result can't be re-run, so it can't be pinned."

## §7 — Pins

- [ ] In the §1 portal, pin the `smoke_ne` records table (**Pin result** → name **"Smoke 1038 pin"** → Save). Open **Pinned Results → Smoke 1038 pin**. It shows rows.
- [ ] Optional, if `smoke_ne` has more than 100 rows and a numeric and a date column: ask **"Compute a 5-period SMA of <numeric> over <date> from that table."** The resulting table refreshes on reload. Its pin action fails with "This result can't be re-run…" (a pin can't carry a transform) — manual.
- [ ] Optional, a large map: on a station with GIS and a view of more than 100 located rows, map it, pin it, and open the pin. It renders through tiles (Network: `/tiles/` requests), not a bounded inline set — manual.

## §8 — Escalated queries keep their recipe — manual

- [ ] Set `SQL_QUERY_JOB_COST_THRESHOLD=1` in `apps/api/.env` and restart the API. In a portal, ask **"Count the records in smoke_ne."** Confirm the background run when asked. When the table arrives, reload: it reads live (one `widget-refresh` `200`) and can be pinned. Remove the setting and restart afterwards.

## §9 — Help

- [ ] Open **Help → FAQ → "How do I refresh a chart, map, or table with the latest data?"** It says a result keeps its query rather than a copy of its data, says it's **no longer available** once you lose access to the data it reads, and says a result with no query **isn't kept**.
- [ ] **"Why do some results appear inline and others as a separate streamed table?"** ends with "Neither is saved with the conversation: when you come back, the result re-reads its data."

---

## Sign-off

- [ ] Every section above verified
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org / portal / message / view / handle ids):
