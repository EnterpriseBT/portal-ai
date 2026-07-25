# REMOVE_VEGA_TOOLS — Smoke Suite

Manual smoke test for [#272](https://github.com/EnterpriseBT/portal-ai/issues/272) — the Vega/Vega-Lite visualization tools, renderers, routing, types, and Postgres enum members are removed. Charting now runs exclusively through the sandboxed `visualize_d3` widget (#274/#275). **Branch under test:** `chore/remove-vega-tools` (PR: _open before merge_).

This is a **removal** ticket, so the walkthrough is a mix of "nothing broke" checks (the app still charts, tables, and text-renders) and "it's actually gone" checks (no tool, no dep, no enum value, no crash on a legacy block). Walk it against your own running stack.

## Preflight

### Environment

- [x] `git checkout chore/remove-vega-tools && git pull --ff-only`
- [x] `npm install` — pulls the lockfile with `vega` / `vega-lite` / `react-vega` removed from `apps/api`, `apps/web`, and `packages/core`.
- [x] `cd apps/api && npm run db:migrate` — applies **`0073_remove_vega_portal_result_types`** (recreates the `portal_result_type` enum as `{text, data-table}`; deletes any pinned rows still carrying a retired type first).
- [x] `npm run dev` boots cleanly (API :3001, web :3000) with no missing-module / import errors in either log.

### Fixtures

- [x] A station with an entity that has some numeric data to chart (e.g. the parcels/sales fixtures you used for #275), with the **`visualize`** toolpack enabled on the station so the agent can reach `visualize_d3`.
- [x] (Optional, for §5) If your dev DB has an old pinned result of type `vega-lite`/`vega` from before this branch, note its portal — the migration will have removed it; confirm the app doesn't choke on its absence.

### Reset between runs

- [x] No reset needed for the read/chart checks. The migration (§4) is one-way; to re-run it from scratch, restore a pre-0073 DB snapshot or re-seed.

## §1 — The Vega vocabulary is gone from the build (AC 1, 2)

- [x] `grep -rn -i vega apps packages --include='*.ts' --include='*.tsx'` returns **only** intentional `#272` regression tests (asserting `vega`/`vega-lite` are rejected/unregistered) — no tool, renderer, dependency, webhook envelope, prompt reference, enum value, or type. No hit in any non-test source file.
- [x] `grep -n vega apps/api/package.json apps/web/package.json packages/core/package.json` returns nothing (no `vega`, `vega-lite`, or `react-vega` dependency in any package).
- [x] `npm run build` at the repo root completes with all packages successful (proves nothing imports a removed dep or symbol).

## §2 — The agent charts via `visualize_d3` only (AC 3)

- [x] Open a portal session on the fixture station and prompt: **"chart the total value by category as a bar chart"**.
- [x] A sandboxed D3 chart widget renders in the response (the `visualize_d3` path). It is **not** a Vega chart and **not** a fallback table (assuming codegen succeeds).
- [x] Inspect the assistant message's tool calls (network tab or `db:studio` → `portal_messages` → the assistant row's `blocks`): the only visualization tool called is **`visualize_d3`**. There is no `visualize` or `visualize_tree` tool call.
- [x] (Optional) In `db:studio` or via the tools API, confirm the station's built toolset contains `visualize_d3` and does **not** contain `visualize` / `visualize_tree`.

## §3 — Existing render paths still work (AC 5, regression)

- [x] Prompt **"show me all the <entity> records"** → a data-table renders (the `display_entity_records` / `data-table` block path is untouched).
- [x] Prompt a large analytical query that returns > the inline threshold (e.g. **"list every <entity> with its id and name"**) → the streaming/handle path renders a **data-table** (via `QueryResultDataBlock`), not an empty or chart-shaped widget.
- [x] A plain text answer (e.g. **"summarize the data in one sentence"**) renders as markdown text.
- [x] Pin a data-table result, then open **Pinned Results**: the card shows the **table** icon and the detail view's Type chip reads **"Table"**. Pin a text result: its Type chip reads **"Text"**. (No "Chart" type appears anywhere.)

## §4 — The enum and pinnability shrank (AC 4)

- [x] In `db:studio` (or `psql`), inspect the `portal_result_type` enum — its only members are **`text`** and **`data-table`**. `vega-lite` and `vega` are gone.
- [x] Attempt to insert a `portal_results` row with `type = 'vega'` (via `psql`): it is **rejected** by the enum constraint.
- [x] Confirm no visualization type is pinnable: prompt for a chart (`visualize_d3` → a `d3` block) and verify the D3 widget shows **no pin affordance** (d3 was never pinnable; with Vega gone, no chart type is).

## §5 — A legacy Vega block degrades gracefully (AC 5, edge)

- [x] If any message history still contains a persisted `vega-lite`/`vega` block (from before this branch), open that portal session. The block renders as **nothing** (null) — the surrounding text/table blocks still render, and there is **no crash, no red error boundary, no blank-screen**.
- [x] If you have no such history, simulate it: in `db:studio`, edit an assistant message's `blocks` JSON to add `{"type":"vega-lite","content":{"mark":"bar"}}`, reload the session, and confirm it renders as nothing with no crash. (Revert the edit after.)

## §6 — Root gates (AC 6)

- [x] `npm run lint` — 0 errors at the root (pre-existing warnings only).
- [x] `npm run type-check` — green (the dual-schema `IsAssignable` assertions confirm the core Zod enum and the Drizzle enum moved together).
- [x] `npm run test` — unit + integration green (the `0073` migration probe runs in the integration suite against a fresh container).

## Sign-off

- [x] Every section above verified
- [x] 2026-07-24 — Ben Turner — confirmed against my own running stack

**Notes on the walk:**
- §3: the large-result data-table renders correctly, but shows only the first 5,000 of 10,254 rows — filed as [#277](https://github.com/EnterpriseBT/portal-ai/issues/277) (pre-existing, unrelated to #272; non-blocking). Text-pin confirmed ("Text" chip); data-table pin-chip depth de-emphasized since pinning is being re-worked in a proceeding ticket.
- §5 verified by injecting a `vega-lite` block into a real assistant message (portal `ff1f0b56`) via SQL, confirming it rendered as nothing, then reverting.

## Bug-filing template

```
Section: §_
Expected:
Got:
Repro:
Identifiers (org / station / portal / message ids):
```
