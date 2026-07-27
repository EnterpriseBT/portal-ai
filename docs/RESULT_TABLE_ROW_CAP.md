# Result-table row cap — make it explicit — Condensed design (#277)

**Issue:** [EnterpriseBT/portal-ai#277](https://github.com/EnterpriseBT/portal-ai/issues/277) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A result over 5,000 rows renders **silently truncated**: the label says "Loading 10,254 rows…", then the table lists 5,000 with nothing indicating the rest exist. The decision (2026-07-27) is to **keep the 5,000-row display cap and make it explicit and accurate**, rather than deliver every row — listing 10,000+ rows is unwieldy for a human anyway, and the useful response is to narrow the query. Packages: `apps/web` (the notice), plus `apps/api` and `packages/core` once the smoke walk found the agent narrating the old behavior — see below. **Sizing stays `condensed`**: the `apps/api` edits are agent-facing text with no behavior change, and the `packages/core` edit is one constant.

Three accuracy constraints shape the copy.

1. **Analysis is not capped.** `sql_query` aggregates, the analytics tools and the agent all operate server-side over the full staged set (up to `HANDLE_ROW_CAP = 100_000`), so the notice must not imply the undelivered rows were excluded from the answer.
2. **But the table's own controls *are* capped, and that is the sharper hazard.** Sort and search run client-side over the delivered 5,000 only. Sorting descending by `diameter_km_max` to find the largest asteroid returns the largest **of the arbitrary first 5,000** — whatever order the SQL happened to return — which is not a truncated answer but a confidently wrong one. Sorting-to-find-extremes is the most natural thing a person does with a table, so the notice must kill this "top-N trap" explicitly. Search has a milder version: a name living in rows 5,001–10,254 returns "no results", which reads as "not in the data".
3. **Today's loading label is itself inaccurate** — it promises a row count the table then doesn't show.

**Found during the smoke walk: the agent's prose was the fourth inaccurate surface, and the worst one.** Beside a correct widget the assistant wrote *"Showing all 10,254 asteroids below."* — wrong on both counts (5,000 are listed; the widget renders *above* the text). It was not hallucinating: that sentence is **prescribed verbatim** in `display-entity-records.tool.ts`'s description and repeated as a worked example in `system.prompt.ts`. An accurate notice sitting next to prose claiming "all 10,254" is worse than no notice, so the agent-facing surfaces are in scope here — per `CLAUDE.md` → "Keeping Documentation in Sync with Capabilities", a capability change must update the tool-description and system-prompt surfaces **in the same PR**.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Single capped fetch | `apps/web/src/components/QueryResultDataBlock.component.tsx:100-103` | `handleSnapshot(handle, { offset: 0, limit: 5_000 })` — stays as-is |
| Loading label | same file, `:59-73` | "Loading {rowCount} rows…" — states the **total**, not what will render |
| "N+" lower bound | same file, `:45` | Already correct for the staging-capped case (#147) |
| Rows → table | same file, `:78-85` | Builds a `data-table` block and hands it to `ContentBlockRenderer` |
| The table itself | `packages/core/src/ui/DataTableBlock.tsx:41-171` | **Already** paginates (`:139-149`), sorts and searches across the rows it is given — untouched here |
| Server clamp | `apps/api/src/services/portal-sql-handle.service.ts:482` | `Math.min(limit, 5_000)` — untouched; no API change |
| Staged total | `packages/core/src/constants/large-data-ops.constants.ts:48` | `HANDLE_ROW_CAP = 100_000` — the full set is staged and analysable |
| Existing tests | `apps/web/src/__tests__/QueryResultDataBlock.test.tsx:26-105` | 5 cases: loading, exact count, `N+`, error, rows→table |
| **Agent surface 1** | `apps/api/src/tools/display-entity-records.tool.ts:47` | Prescribes the exact bad sentence: *"acknowledge the row count in one short sentence ('Showing all 5,402 parcels below.')"* |
| **Agent surface 2** | `apps/api/src/tools/sql-query.tool.ts:45` | *"Either way the user sees every row."* — now false |
| **Agent surface 3** | `apps/api/src/prompts/system.prompt.ts:284` | Worked example repeats *"Showing all 5,402 parcels below."* |
| Pack mirror | `packages/core/src/registries/builtin-toolpacks.ts` | Checked — does **not** duplicate these two descriptions, so no mirror edit needed |

Note the issue's title ("no pagination past first snapshot page") is misleading: pagination exists and works. Only the *delivered row set* is short.

## Decision — derive the notice from rows actually received, not from a constant

The obvious implementation compares `rowCount` against a hardcoded `5_000`. That re-creates the drift that made this bug confusing — the literal already appears independently in the client and in the service clamp, and if either changes the message silently becomes a lie.

**Chosen:** compute the notice from `rows.length` versus `rowCount`. If fewer rows arrived than the total, say so using the real number received — accurate no matter what any clamp is set to.

This is why the shared `TABLE_DISPLAY_ROW_LIMIT` constant (slice 2) does **not** weaken the rule: the notice still never compares against it. The constant exists for the surfaces that must state the limit *before any rows exist* — the loading label, and the two agent-facing tool descriptions. Anywhere rows are in hand, the received count wins.

- `rows.length >= rowCount` and not truncated → **no notice** (nothing is hidden).
- `rows.length < rowCount` → notice naming both real numbers.
- `truncated` → the total is itself a lower bound, so render it as `N+` (reusing the existing `:45` treatment).

Copy — states what is capped, what isn't, and what to do instead:

> **Showing the first 5,000 of 10,254 rows.** All 10,254 were analysed — but this table's sort and search only cover the 5,000 shown, so they won't find or rank rows beyond them. To rank or filter across everything, ask for it in the query (e.g. "top 20 by diameter" or "asteroids over 1 km").

Three clauses, each load-bearing and each separately asserted by a test:

- *"All 10,254 were analysed"* — without it, a user reasonably concludes their average or count covered only 5,000.
- *"sort and search only cover the 5,000 shown"* — the top-N trap. This is the clause that stops a user ranking a truncated set and trusting the top row.
- *"ask for it in the query"* — makes "narrow your query" actionable. Vague advice to narrow doesn't tell someone hunting the largest asteroid what to actually do.

Rendered as an MUI `<Alert severity="info">` above the table, and the loading label is corrected from "Loading 10,254 rows…" to name what will actually render.

## Plan — 2 slices

**Slice 1 — the widget's notice**

- Edit: `apps/web/src/components/QueryResultDataBlock.component.tsx` — `QueryResultDataBlockUIProps` gains nothing (it already receives `rows` + `rowCount` + `truncated`); the UI derives and renders the notice, and the loading label is corrected.
- Edit: `apps/web/src/__tests__/QueryResultDataBlock.test.tsx` — extend the existing 5 cases.

**Slice 2 — the agent's narration** (added after the smoke walk)

- New: `TABLE_DISPLAY_ROW_LIMIT` in `packages/core/src/constants/large-data-ops.constants.ts` — four surfaces must now agree on the number, so it stops being a literal copied per file. The web component and both tool descriptions read it.
- Edit: `apps/api/src/tools/display-entity-records.tool.ts` — replace the prescribed sentence; state that the table lists at most the limit and says so itself, that every staged row is still analysed, and that the widget's position must not be asserted.
- Edit: `apps/api/src/tools/sql-query.tool.ts` — replace "the user sees every row" with the accurate split (staged/analysed vs. listed).
- Edit: `apps/api/src/prompts/system.prompt.ts` — fix the worked example (`Found 5,402 parcels.`), add a capped-result example, and forbid positional language for widgets.
- Edit: `apps/api/src/__tests__/prompts/system.prompt.test.ts` — 3 cases.

**Tests** (`cd apps/web && npm run test:unit`)

1. `rows.length < rowCount` → notice renders, naming both the received count and the total.
2. Notice states the full set **was analysed** — asserts that clause specifically, so a future copy edit can't quietly drop the reassurance.
3. Notice states that **sort and search cover only the shown rows** — asserts the top-N-trap clause specifically. This is the one a well-meaning copy trim is most likely to delete as wordy, and the one whose absence lets a user trust a wrong ranking.
4. Notice tells the user to **ask for ranking/filtering in the query** — asserts the actionable clause.
5. `rows.length === rowCount` → **no** notice.
6. `truncated` → total rendered as `N+` in the notice.
7. Empty result (`rows: []`, `rowCount: 0`) → no notice, no crash.
8. Loading label names what will render rather than the full total.
9. Existing 5 cases still pass (error state, rows→table routing).

Cases 2–4 assert the three clauses separately rather than matching the whole string, so wording can be improved without breaking tests while the *substance* stays pinned.

**Slice 2 tests** (`cd apps/api && npm run test:unit`) — `system.prompt.test.ts`:

10. The prompt no longer teaches `Showing all N … below` and no longer claims the user sees every row.
11. The prompt uses no positional language for widgets (`table below` etc.).
12. The prompt teaches acknowledging the display cap, and that the cap is on the listing rather than the analysis.

The tool descriptions are covered transitively — they read `TABLE_DISPLAY_ROW_LIMIT`, so a drifted number is a type error rather than a stale string.

## Smoke (manual, against your dev stack)

1. `npm run dev`, open a portal on the asteroid station (10,254 rows).
2. Prompt *"show me a list of all asteroids"* → table renders; an info notice above it reads **"Showing the first 5,000 of 10,254 rows"**, says the full set was analysed, and suggests narrowing. No vertical clipping of the notice.
3. Confirm the numbers are real: the table's own pagination footer counts **5,000**, matching the notice's first number.
4. Page to the last page of the table — it ends at row 5,000, consistent with the notice rather than silently short.
5. Prompt *"show me the 50 closest approaches"* → table renders with **no** notice (nothing hidden).
6. Prompt an aggregate over everything, e.g. *"what is the average miss_distance_km across all asteroids?"* → the answer reflects all 10,254 rows, confirming the notice's claim that analysis is not capped.
7. Sort and search within the capped table still work over the 5,000 rows shown.
8. **Verify the top-N trap the notice warns about is real** (so the warning is earned, not boilerplate): sort the capped table descending by `diameter_km_max` and note the top value, then prompt *"what is the largest asteroid by diameter_km_max?"*. The agent's answer covers all 10,254 rows, so the two may disagree — and the notice is what tells the user which to trust. If they happen to agree, re-check with a column whose extreme is likelier to sit beyond row 5,000.
9. Confirm the loading label (visible briefly, or throttle the network) no longer promises more rows than it renders.
10. **The agent's own sentence is accurate** (the smoke-walk regression): its closing text reports the true total without claiming all rows are listed — e.g. *"Found 10,254 asteroids; the table lists the first 5,000."* — and contains no "below"/"above" placement of the widget. Prompt a small result too (*"the 50 closest approaches"*) and confirm the narration is a plain *"Found 50 …"* with no cap language.

## Out of scope

- **Delivering every row** (paging the snapshot endpoint to completion). Considered and declined: 10,000+ listed rows are unwieldy for a human, and holding up to 100k rows client-side costs ~100–200 MB plus a full copy per sort.
- **Server-side sort/filter/paging.** The scalable answer if the cap ever needs to rise; it redefines what the table's sort and search mean and needs new API surface.
- **Changing the snapshot endpoint's clamp** — `portal-sql-handle.service.ts:482` stays exactly as it is. (The `apps/api` edits in slice 2 are agent-facing text only, no behavior change.)
- **Raising or lowering `HANDLE_ROW_CAP`.**
- **CSV / full-result export** — the honest answer for "I genuinely need all 10,254 rows", and the natural companion to a capped view. Worth its own ticket rather than smuggling in here.
- **`DataTableBlock`'s rows-per-page options** (currently max 100, so 5,000 rows is 50 pages). Tuning them is a separate, purely cosmetic change.
