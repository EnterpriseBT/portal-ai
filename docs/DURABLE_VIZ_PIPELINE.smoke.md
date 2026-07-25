# DURABLE_VIZ_PIPELINE — Smoke Suite

Manual smoke test for [#270](https://github.com/EnterpriseBT/portal-ai/issues/270) — a `d3` visualization widget's data pipeline is now durable and re-executable: expired/stale widgets re-hydrate with live data (auto on view, or via a manual refresh button), through a reference-only, org-scoped, free `POST /api/portal-sql/widget-refresh`. **Branch under test:** `feat/durable-viz-pipeline` (PR: _open before merge_; base `epic/d3-dashboard-widgets`).

This builds on #268/#269 (already merged into the epic). Walk it against your own running stack.

## Preflight

### Environment

- [ ] `git checkout feat/durable-viz-pipeline && git pull --ff-only`
- [ ] `npm install`
- [ ] **No migration** — the durable pipeline rides the existing `portal_messages.blocks` jsonb; nothing to `db:migrate` for this ticket.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000) with no import/type errors in either log.

### Fixtures

- [ ] A station with an entity holding some numeric data to chart (e.g. the parcels/sales fixtures), with the **`visualize`** toolpack enabled so the agent can reach `visualize_d3`.
- [ ] `db:studio` open (`cd apps/api && npm run db:studio`) to inspect `portal_messages.blocks` and to age a message for the reopened-session checks.

### Reset between runs

- [ ] Mostly read-only. §4/§5 have you hand-edit a `portal_messages` row in `db:studio` (age a timestamp / add a legacy block) — note the row id and revert it after, or just create a new chart for a clean run. A hard page reload clears the in-memory freshness clock (so a widget re-auto-refreshes on next view).

## §1 — Newly minted widgets carry the durable pipeline (AC 4)

- [ ] In a portal session on the fixture station, prompt: **"chart the total value by category as a bar chart"**. A D3 chart widget renders.
- [ ] In `db:studio`, open `portal_messages` → the assistant row → the `blocks` JSON. The `d3` block has a **`pipeline`** object with **`sql`**, **`stationId`**, and **`organizationId`** (the query that fed the chart). This is present independent of any Redis handle.
- [ ] Prompt a **large** chart (a query returning > ~100 rows, e.g. **"plot every parcel's assessed value by acreage as a scatter"**). Its `d3` block is the handle variant *and* still carries the same `pipeline` object.

## §2 — Manual refresh + freshness cue (AC 5 manual half, AC 3)

- [ ] The rendered chart shows a **refresh icon button** (hover tooltip "Refresh chart") and an **"Updated … ago"** caption.
- [ ] Click **Refresh**. The button shows a spinner and is disabled briefly; the chart re-renders in place with current data; the "Updated … ago" caption resets to "just now"/seconds.
- [ ] Change the underlying data (e.g. add/edit a record for the charted entity via the app or a connector sync), then click **Refresh** again → the chart reflects the change **without** asking the assistant anything.

## §3 — Auto-refresh when stale, not when fresh (AC 1, AC 5 auto half)

- [ ] **Fresh (no refetch):** right after §2, open the browser Network tab, and re-render the same message (e.g. scroll it out and back). Within a few minutes of the last hydration, **no** new `POST /api/portal-sql/widget-refresh` fires (the freshness gate holds).
- [ ] **Stale (auto refetch):** in `db:studio`, set that assistant message's **`created`** to well in the past (e.g. yesterday), then **hard-reload** the session. On viewing the widget, a `POST /api/portal-sql/widget-refresh` fires automatically and the chart hydrates with live data — **no agent round-trip, no manual click**.
- [ ] **Reopened days later / expired handle:** for a large (handle) chart, let its 24h Redis handle expire (or `redis-cli FLUSHALL` on your dev Redis), then reopen the session. The widget **auto-recovers** with fresh data instead of the old "data has expired — re-run the original query" dead-end.

## §4 — Reference-only, org-scoped, SQL-never-from-client (AC 2)

- [ ] Grab a real `{ messageId, blockIndex }` for a `d3` block (from `db:studio` / the network tab). `curl` the endpoint as yourself:
  `POST /api/portal-sql/widget-refresh` with body `{"messageId":"…","blockIndex":N}` and your bearer token → 200 with a fresh `{kind:"inline"|"handle", …}` payload.
- [ ] **Client SQL is ignored:** repeat the call with an extra `"sql":"SELECT 1 AS pwned"` in the body → the response is unchanged (reflects the *persisted* pipeline, not your `sql`).
- [ ] **Cross-org isolation:** as a user in a **different** org (or with a `messageId` from another org), call the endpoint → **404** (`VIZ_WIDGET_NOT_FOUND`), never data. A bogus `messageId` → **404** too (no existence leak).

## §5 — Failure & edge states (AC 5 failure half, Risks)

- [ ] **Refresh failure keeps the prior render:** with a chart displayed, stop the API server (or block the endpoint) and click **Refresh** → the chart **stays rendered** (prior view intact) and a typed error is surfaced — no blank/corrupted chart. Restart the API and refresh succeeds.
- [ ] **Legacy block (no pipeline):** in `db:studio`, add a `d3` block **without** a `pipeline` field to an assistant message (or use a pre-#270 one if you have it), reload → the widget shows the **"This chart can't auto-refresh — re-run the prompt for live data."** note (from `VIZ_WIDGET_NOT_REFRESHABLE`), not a crash. Revert the edit.
- [ ] **Free / rate-limited:** confirm a refresh does **not** change your org's usage allocation (Settings → Organization, or the session's Itemized usage — the refresh isn't listed). Optionally hammer the endpoint > 120×/min for one org → eventual **429** (`VIZ_REFRESH_RATE_LIMITED`) while normal use never hits it.

## §6 — Root gates (AC 6)

- [ ] `npm run lint` — 0 errors (pre-existing warnings only).
- [ ] `npm run type-check` — green.
- [ ] `npm run test` — unit + integration green (the `widget-refresh` route integration test runs against a fresh container).

## Sign-off

- [ ] Every section above verified
- [ ] ____-__-__ — <name> — confirmed against my own running stack

## Bug-filing template

```
Section: §_
Expected:
Got:
Repro:
Identifiers (org / station / portal / message id / blockIndex):
```
