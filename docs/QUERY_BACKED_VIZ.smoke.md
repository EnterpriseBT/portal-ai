# QUERY_BACKED_VIZ — Smoke Suite

Manual smoke test for [#349](https://github.com/EnterpriseBT/portal-ai/issues/349) — every visualization is query-backed: the terminal inline snapshot is gone, tables carry a durable pipeline and refresh like charts and maps, and all four surfaces share one freshness chrome.

**Branch under test:** `feat/query-backed-viz` (no PR open yet — open one before merging).

Run **§Preflight** once before any section. The rest can be walked top-to-bottom; each section is independent after preflight.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section in the issue body (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/query-backed-viz && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core` — **required.** This branch adds `data-table-widget.contract.ts` and `WidgetFreshnessBar` to core and renames `D3PipelineSchema` → `VizPipelineSchema`; `apps/api` and `apps/web` compile against core's `dist/`, so a stale build throws phantom type errors.
- [ ] **No migration.** This branch changes no DB schema and adds no `ApiCode`. If `npm run db:migrate` wants to apply something, it isn't from this branch.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).
- [ ] Redis is reachable (the refresh rate-limiter and query handles both use it).
- [ ] Auth0 dev tenant works — login lands on `/dashboard`.

### Fixtures

| Alias | Shape | Used by |
|---|---|---|
| **a station with a sizable entity** | Any connector entity with **well over 100 rows** and at least one numeric column to rank by (the NEO fixture from `LARGE_DATA_OPS.smoke.md` works). 100 is `INLINE_ROWS_THRESHOLD` — you need to be able to land on both sides of it. | all sections |
| **a mutable entity** | Something you can add a row to between refreshes (a small CSV-uploaded entity is easiest). Needed to prove a refresh changes the result *set*, not just re-renders it. | §3 |

### Reset between runs

- [ ] No reset needed — refresh is read-only and message blocks are never rewritten. Start a **new portal session** per section so you're not reading a widget you already warmed.
- [ ] `npm run db:studio` (from `apps/api/`) — used below to inspect `portal_messages.blocks` and `portal_results.content`.
- [ ] The freshness window is **3 minutes** (`VIZ_REFRESH_FRESHNESS_MS`). "Re-view after the window" steps mean waiting that long, or reloading the page (a reload clears the in-memory hydration clock).

---

## §1 — An inline table is query-backed (AC 2, 3)

The core defect: a small table used to be a terminal snapshot with nothing behind it.

- [ ] In a portal, prompt: **"show me the 10 largest <things> by <numeric column>"** — something returning **≤ 100 rows**, so it takes the inline path.
- [ ] The table renders, and above it there is an **"Updated … ago"** note and a **refresh icon button**.
- [ ] Hover the button — the tooltip reads **"Refresh table"**.
- [ ] Click it. The spinner appears, then the timestamp resets to "Updated less than a minute ago".
- [ ] **The page does not freeze, blank, or throw a stack-overflow error.** (The retired renderer drew its rows by re-entering the block registry; now that `data-table` maps to `TableWidget`, that path would be infinite recursion. A hang or "Maximum call stack size exceeded" in the console is this bug.)
- [ ] In `db:studio` → `portal_messages` → the assistant message's `blocks`: the `data-table` block's `content` carries a **`pipeline`** object with `sql`, `stationId`, `organizationId`.

---

## §2 — A handle-backed table is query-backed (AC 2, 3)

This is the path that silently lost its `BlockRef` before — the block was diverted to a renderer that received no render context at all.

- [ ] Prompt something returning **well over 100 rows** (e.g. **"list every <thing>"**), so the result is staged as a query handle.
- [ ] The table renders its rows (fetched from the handle snapshot), **and** shows the same "Updated … ago" + refresh button as §1.
- [ ] Click refresh — it succeeds and the timestamp resets.
- [ ] If the result is over 5,000 rows (`TABLE_DISPLAY_ROW_LIMIT`), the blue **"Showing the first N of M rows"** notice still appears above the table, and still contains both the "sort and search only cover the N shown" warning and the "ask for it in the query" advice.
- [ ] In `db:studio`, this block's `content` carries **both** `queryHandle` and `pipeline`.

---

## §3 — A top-N refresh changes the SET, not just the values (AC 4)

The acceptance criterion that motivated the ticket.

- [ ] Against the **mutable** entity, prompt: **"show me the top 5 <things> by <numeric column>"**. Note the rows.
- [ ] Without leaving the page, add a row to that entity that **belongs in the top 5** (upload a CSV row, or insert via `db:studio`).
- [ ] Click the table's refresh button.
- [ ] **The new row appears in the table and the previous 5th row drops off.** The set changed — this is the "a newly-largest wildfire appears" case. A refresh that re-renders the same five rows with the same values is the bug.

---

## §4 — Degraded state on a failed refresh (AC 5)

The user-visible failure contract: last-good data stays, the cue reports the problem, and **no toast fires**.

- [ ] Find your org id (`db:studio` → `organizations`, or the org switcher).
- [ ] Exhaust the per-org refresh window by seeding the counter directly — the cap is **120/min** (`VIZ_REFRESH_RATE_PER_MIN`), so hand-clicking won't get you there:
  ```bash
  # minute bucket = floor(epoch_seconds / 60)
  redis-cli SET "usage:rate:viz-refresh:<ORG_ID>:$(( $(date +%s) / 60 ))" 120
  ```
- [ ] Immediately click a table's refresh button (same wall-clock minute).
- [ ] The freshness cue flips to a **warning chip reading "Couldn't update — showing data from …"**.
- [ ] **The table's rows are still on screen** — the widget did not blank or replace itself with an error.
- [ ] **No toast appears** in the bottom-right. (A toast here is a bug: a dashboard of several widgets would produce a storm.)
- [ ] Wait for the next minute and click refresh again — it succeeds and the chip reverts to a normal "Updated …" note.

---

## §5 — A legacy (pre-#349) table shows the cue but no button (AC 6)

- [ ] Find a `data-table` block persisted **before this branch** (an older portal session), or manufacture one: in `db:studio` → `portal_messages`, edit an assistant message's `blocks` JSON and **delete the `pipeline` key** from a `data-table` block's `content`.
- [ ] Reload the portal and view that message.
- [ ] The table renders its stored rows, shows an **"Updated … ago"** note, and has **no refresh button**.
- [ ] No error banner, no console exception, no toast. Nothing failed — the block simply predates durable pipelines.
- [ ] *(Optional, API-level)* `POST /api/portal-sql/widget-refresh` with that `{ messageId, blockIndex }` returns **422 `VIZ_WIDGET_NOT_REFRESHABLE`** — not 404. This is a deliberate status change in this branch.

---

## §6 — A pinned inline table is refreshable (AC 7)

Closes the discovery's open question 6 — this needed no pin-side code, so a failure here points upstream.

- [ ] From §1's inline table, click the **pin** affordance and give it a name.
- [ ] In `db:studio` → `portal_results`: the new row's `content` carries a **`pipeline`**.
- [ ] Open the pinned result's detail page (`/portal-results/…`).
- [ ] It shows an **"Updated … ago"** note and a refresh button (tooltip **"Refresh data"**).
- [ ] Click refresh. The rows reload and `snapshotUpdatedAt` on that row advances (`db:studio`).
- [ ] Change the underlying data, refresh again — the pin's **stored** `content.rows` updates too (pins persist their fresh snapshot; message blocks deliberately do not).
- [ ] **Exactly one** freshness cue and **one** refresh button on the page. The walk originally found two: the page-level control predated tables having their own chrome, and rendered alongside the widget's — which also double-fired the mount auto-refresh, spending two rate-budget calls per view. Fixed in `72b4ce7f`; the widget is now the single refresher.

> **Known, filed separately — not a #349 defect.** A pinned **handle-backed map** (a map over 100 rows) renders "No mappable features in this result." until manually refreshed: materialization stores raw WKB where the inline mint path stores GeoJSON. Pre-existing #312/#314 behavior, tracked in [#371](https://github.com/EnterpriseBT/portal-ai/issues/371). Not a blocker for this PR.

---

## §7 — Map and chart widgets are unchanged (AC 8)

All three surfaces now render through the same extracted chrome; this section is the regression check.

- [ ] Prompt a **chart** (e.g. **"chart <numeric column> by <category>"**). It renders, shows "Updated … ago" and a refresh button whose tooltip reads **"Refresh chart"**. Click it — it works.
- [ ] While a chart is loading/rendering, the status chip still appears (**Loading** / **Rendering** / **Refreshing** / **Stale** / **Error** as applicable). None of the five is missing.
- [ ] Prompt a **map** (e.g. **"map the <things>"**). It renders, shows "Updated … ago" and a refresh button whose tooltip reads **"Refresh map"**. Click it — it works.
- [ ] Prompt a map over **more than 100 rows** so it tiles — panning still re-queries per viewport as before.
- [ ] Visually: the header row on chart, map, and table all sit at the same height with the same spacing — no layout shift or doubled headers introduced by the extraction.
- [ ] A chart whose codegen fails (hard to force deliberately; if you happen to see one) degrades to a **table that still has a working refresh button** and the "Couldn't generate the visualization…" note.

---

## §8 — Invariants and no-regressions (AC 1, 9)

- [ ] `npm run lint && npm run type-check && npm run test` at the repo root — all clean. (Integration tests need the `postgres-test` container: `cd apps/api && npm run test:integration`.)
- [ ] The API log shows **no new error codes** during the walkthrough — this branch added none.
- [ ] Rate limiting is unchanged: after §4, normal refreshing works at ordinary click rates without tripping 429.
- [ ] Open a portal with **several** widgets (a table, a chart, a map) and reload. They hydrate without a burst of refreshes — the 3-minute freshness gate suppresses re-fetch for just-viewed widgets. Watch the API log: you should not see one `widget-refresh` call per widget per reload.
- [ ] Scroll a long session so widgets leave the viewport and come back — they re-mount and render correctly (the gate tears them down offscreen).
- [ ] The **Help → Glossary** entry for *Visualization Widget* reads "a live chart, map, or table", and the FAQ answer **"How do I refresh a chart, map, or table with the latest data?"** is present and accurate.

---

## Sign-off checklist

- [ ] §1 (inline table) — pipeline persisted; cue + working refresh; no recursion.
- [ ] §2 (handle table) — same chrome; `BlockRef` reaches the widget; row-cap notice intact.
- [ ] §3 (top-N) — the row **set** changes on refresh.
- [ ] §4 (degraded) — warning chip, rows retained, no toast.
- [ ] §5 (legacy block) — cue without a button; 422 not 404.
- [ ] §6 (pinned table) — pin carries a pipeline and refreshes; snapshot persists back.
- [ ] §7 (map + chart) — unchanged behavior through the shared chrome; all status chips present.
- [ ] §8 (invariants) — suites green; no new codes; no refresh burst; Help copy accurate.

- [ ] _<date> — <name>_ — confirmed against my own running stack.

After every box is ticked: report ready-to-merge in the PR thread, or file follow-up bugs against any failing case.

---

## Bug-filing template

```
**Section:** §<X> — <name>
**Step:** <which step>
**Expected:** <what this doc says should happen>
**Got:** <screenshots, console errors, db row inspections>
**Repro:** <prompt + preconditions>
**Identifiers:** <org id / message id + blockIndex / portal_result id>
```
