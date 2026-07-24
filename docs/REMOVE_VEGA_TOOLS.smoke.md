# REMOVE_VEGA_TOOLS — Smoke Suite

Manual smoke test for [#272](https://github.com/EnterpriseBT/portal-ai/issues/272) — the Vega/Vega-Lite visualization tools, renderers, routing, types, and Postgres enum members are removed. Charting now runs exclusively through the sandboxed `visualize_d3` widget (#274/#275). **Branch under test:** `chore/remove-vega-tools` (PR: _open before merge_).

This is a **removal** ticket, so the walkthrough is a mix of "nothing broke" checks (the app still charts, tables, and text-renders) and "it's actually gone" checks (no tool, no dep, no enum value, no crash on a legacy block). Walk it against your own running stack.

## Preflight

### Environment

- [ ] `git checkout chore/remove-vega-tools && git pull --ff-only`
- [ ] `npm install` — pulls the lockfile with `vega` / `vega-lite` / `react-vega` removed from `apps/api`, `apps/web`, and `packages/core`.
- [ ] `cd apps/api && npm run db:migrate` — applies **`0073_remove_vega_portal_result_types`** (recreates the `portal_result_type` enum as `{text, data-table}`; deletes any pinned rows still carrying a retired type first).
- [ ] `npm run dev` boots cleanly (API :3001, web :3000) with no missing-module / import errors in either log.

### Fixtures

- [ ] A station with an entity that has some numeric data to chart (e.g. the parcels/sales fixtures you used for #275), with the **`visualize`** toolpack enabled on the station so the agent can reach `visualize_d3`.
- [ ] (Optional, for §5) If your dev DB has an old pinned result of type `vega-lite`/`vega` from before this branch, note its portal — the migration will have removed it; confirm the app doesn't choke on its absence.

### Reset between runs

- [ ] No reset needed for the read/chart checks. The migration (§4) is one-way; to re-run it from scratch, restore a pre-0073 DB snapshot or re-seed.

## §1 — The Vega vocabulary is gone from the build (AC 1, 2)

- [ ] `grep -rn -i vega apps packages --include='*.ts' --include='*.tsx'` returns **only** intentional `#272` regression tests (asserting `vega`/`vega-lite` are rejected/unregistered) — no tool, renderer, dependency, webhook envelope, prompt reference, enum value, or type. No hit in any non-test source file.
- [ ] `grep -n vega apps/api/package.json apps/web/package.json packages/core/package.json` returns nothing (no `vega`, `vega-lite`, or `react-vega` dependency in any package).
- [ ] `npm run build` at the repo root completes with all packages successful (proves nothing imports a removed dep or symbol).

## §2 — The agent charts via `visualize_d3` only (AC 3)

- [ ] Open a portal session on the fixture station and prompt: **"chart the total value by category as a bar chart"**.
- [ ] A sandboxed D3 chart widget renders in the response (the `visualize_d3` path). It is **not** a Vega chart and **not** a fallback table (assuming codegen succeeds).
- [ ] Inspect the assistant message's tool calls (network tab or `db:studio` → `portal_messages` → the assistant row's `blocks`): the only visualization tool called is **`visualize_d3`**. There is no `visualize` or `visualize_tree` tool call.
- [ ] (Optional) In `db:studio` or via the tools API, confirm the station's built toolset contains `visualize_d3` and does **not** contain `visualize` / `visualize_tree`.

## §3 — Existing render paths still work (AC 5, regression)

- [ ] Prompt **"show me all the <entity> records"** → a data-table renders (the `display_entity_records` / `data-table` block path is untouched).
- [ ] Prompt a large analytical query that returns > the inline threshold (e.g. **"list every <entity> with its id and name"**) → the streaming/handle path renders a **data-table** (via `QueryResultDataBlock`), not an empty or chart-shaped widget.
- [ ] A plain text answer (e.g. **"summarize the data in one sentence"**) renders as markdown text.
- [ ] Pin a data-table result, then open **Pinned Results**: the card shows the **table** icon and the detail view's Type chip reads **"Table"**. Pin a text result: its Type chip reads **"Text"**. (No "Chart" type appears anywhere.)

## §4 — The enum and pinnability shrank (AC 4)

- [ ] In `db:studio` (or `psql`), inspect the `portal_result_type` enum — its only members are **`text`** and **`data-table`**. `vega-lite` and `vega` are gone.
- [ ] Attempt to insert a `portal_results` row with `type = 'vega'` (via `psql`): it is **rejected** by the enum constraint.
- [ ] Confirm no visualization type is pinnable: prompt for a chart (`visualize_d3` → a `d3` block) and verify the D3 widget shows **no pin affordance** (d3 was never pinnable; with Vega gone, no chart type is).

## §5 — A legacy Vega block degrades gracefully (AC 5, edge)

- [ ] If any message history still contains a persisted `vega-lite`/`vega` block (from before this branch), open that portal session. The block renders as **nothing** (null) — the surrounding text/table blocks still render, and there is **no crash, no red error boundary, no blank-screen**.
- [ ] If you have no such history, simulate it: in `db:studio`, edit an assistant message's `blocks` JSON to add `{"type":"vega-lite","content":{"mark":"bar"}}`, reload the session, and confirm it renders as nothing with no crash. (Revert the edit after.)

## §6 — Root gates (AC 6)

- [ ] `npm run lint` — 0 errors at the root (pre-existing warnings only).
- [ ] `npm run type-check` — green (the dual-schema `IsAssignable` assertions confirm the core Zod enum and the Drizzle enum moved together).
- [ ] `npm run test` — unit + integration green (the `0073` migration probe runs in the integration suite against a fresh container).

## Sign-off

- [ ] Every section above verified
- [ ] ____-__-__ — <name> — confirmed against my own running stack

## Bug-filing template

```
Section: §_
Expected:
Got:
Repro:
Identifiers (org / station / portal / message ids):
```
