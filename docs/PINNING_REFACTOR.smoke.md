# pinning-refactor — Smoke Suite

Manual smoke test for [#312](https://github.com/EnterpriseBT/portal-ai/issues/312) — pin any durable block type (`text` / `data-table` / `d3` / `geo`), pin-time materialization (self-contained snapshots, no handle-TTL dependence), and live data in the pinned-result detail view (auto-refresh + persist-back). **Branch under test:** `feat/pinning-refactor`.

Run **§Preflight** once. §1–§5 are independent after it. Filing bugs: issue on `EnterpriseBT/portal-ai`, type `Bug`, link this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/pinning-refactor && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core` — the pinned-content contracts and `BlockRef` union live in core; web/api need the rebuilt dist.
- [ ] `cd apps/api && npm run db:migrate && cd ../..` — migration `0074_widen-portal-result-type-live-pins.sql` adds `d3`/`geo` to the `portal_result_type` pg enum and the `snapshot_updated_at` column. Confirm it applies cleanly.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`); Redis reachable.

### Fixtures

- [ ] A station with the **`data_query`** and **`visualize`** toolpacks and a connector entity with a meaningful row count — **≥ 150 rows** so at least one query crosses `INLINE_ROWS_THRESHOLD` (100) and comes back handle-backed. The NEO fixture from `LARGE_DATA_OPS.smoke.md` works.
- [ ] `npm run db:studio` (from `apps/api/`) open on the `portal_results` table — several steps inspect `content` and `snapshot_updated_at`.

### Reset between runs

- [ ] Unpin anything this walkthrough pinned (Dashboard or the Pinned Results page). No other state is written.

---

## §1 — Pin any durable block (materialization)

- [ ] In a portal session, prompt: **"show me a bar chart of <your data> by <category>"** → a d3 widget renders. Hover the block: a **pin affordance appears on the chart block** (pre-#312 it never did).
- [ ] Pin it (name it "Smoke Chart"). The pin succeeds — no `PORTAL_RESULT_TYPE_NOT_PINNABLE` error.
- [ ] Prompt: **"list all <records> in a table"** (must exceed 100 rows so the table is handle-backed — the row-count banner shows a total, not inline rows). The pin affordance appears on this table block too; pin it as "Smoke Big Table".
- [ ] Pin a plain text answer as "Smoke Text" (the pre-#312 behavior — control case).
- [ ] `db:studio` → `portal_results`: the "Smoke Chart" row has `type = d3` and `content` containing `program`, `rows` (materialized array), and `pipeline { sql, stationId, organizationId }`; `snapshot_updated_at` is set. The "Smoke Big Table" row has `type = data-table`, `content.rows` (≤ 5 000), `rowCount`, `truncated`, `pipeline` — and **no `queryHandle` key** (the ephemeral envelope must not persist).

## §2 — Live data in the detail view

- [ ] Open **Pinned Results** → "Smoke Chart": the interactive d3 widget renders (not a static image or empty block), with the refresh control in the widget chrome.
- [ ] Open "Smoke Big Table": the table renders from the stored snapshot, with a **Refresh data** control and an "Updated ⟨time⟩ ago" caption above it.
- [ ] Change the underlying data (e.g. run a small sync, or an agent prompt that inserts/updates a record the pinned query covers). Wait **> 3 minutes** (the freshness window), reopen the pinned result: it **auto-refreshes once** — visible refreshing state, then the new data appears without clicking anything.
- [ ] Click the manual refresh button: it spins and settles; data stays current.
- [ ] `db:studio` → `portal_results`: after the refreshes, the row's `snapshot_updated_at` advanced and `content.rows` reflect the changed data (**persist-back**).

## §3 — Fallbacks & degraded states

- [ ] **Handle-expiry survival**: pins must outlive the 24h Redis handle TTL. Simulate expiry: `redis-cli --scan --pattern '*qh-*' | xargs -r redis-cli DEL`, then reopen "Smoke Big Table" — the stored snapshot still renders (pre-#312 this was an empty table).
- [ ] **Refresh failure keeps the snapshot**: break the pipeline's source (delete the connector entity the pinned query reads, or stop the API mid-refresh), then refresh the pin — the **last saved rows stay visible** plus a warning notice ("Refresh failed — showing the last saved data"). Never a blank view.
- [ ] **Pipeline-less pin is static**: pin a *small* table answer (≤ 100 rows, inline — no handle, no SQL retained). Its detail view shows **no refresh control** and no auto-refresh fires.
- [ ] **Legacy snapshot-less pin**: simulate a pre-#312 row — in `db:studio` (or psql) edit a pinned data-table row's `content` to `{"queryHandle": "qh-dead", "columns": ["a"]}` (no `rows`). Its detail view shows the explicit **"saved data has expired"** notice — not a silent empty table.
- [ ] **Tombstoned source**: delete the portal the pins came from (Dashboard → portal delete). Reopen a pin: it still renders; the metadata shows **Source: Portal deleted** and no "Open Source Portal" action.

## §4 — Unpin surfaces & back-compat

- [ ] Any pin created **before** this branch (if your dev DB has one) still renders exactly as before; its `snapshot_updated_at` is null and nothing about it errors.
- [ ] Unpin from the **Dashboard** card: one DELETE in the Network tab, card disappears.
- [ ] Unpin from the **Pinned Results page** card: same.
- [ ] With devtools **offline**, unpin from the list page: a persistent error toast appears ("Could not remove this pinned result…") with **Retry**; back online, Retry completes the unpin.
- [ ] The pinned-results list shows distinct type icons: text snippet, table, **chart (d3)**.

## §5 — Error & edge cases

- [ ] **Transient blocks stay unpinnable**: trigger a bulk job (e.g. a bulk transform) and confirm the in-chat progress block offers **no pin affordance** while running. (The server-side typed rejection for transient kinds is pinned by the integration suite — `PORTAL_RESULT_TYPE_NOT_PINNABLE`.)
- [ ] **Rate limit (not manually verified)**: the 429 past 120 refreshes/min/org is impractical to trip by hand; it is covered by the integration test (`POST /:id/refresh` 429 case). Noted here so the criterion isn't silently dropped.
- [ ] **Geo**: no geo blocks exist pre-#84, so geo pinning is unreachable — nothing to walk; the contract seam is covered by core tests.

## Sign-off

- [ ] Every section above verified
- [ ] ⟨date⟩ ⟨name⟩ — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org / portalResult / portal ids):
