# result-rowcount-reporting — Smoke Suite

Manual smoke test for [#340](https://github.com/EnterpriseBT/portal-ai/issues/340) — large results report the **true matched total** (via a same-txn `COUNT(*)`) instead of the `100,001` staging-cap probe, across data tables and d3 charts. **Branch under test:** `fix/result-rowcount-reporting` (PR [#345](https://github.com/EnterpriseBT/portal-ai/pull/345), base `main`).

## Preflight

### Environment

- [ ] `git checkout fix/result-rowcount-reporting && git pull --ff-only`
- [ ] `npm install`
- [ ] **No migration** — additive optional contract fields only.
- [ ] Rebuild core so the app sees the new envelope fields: `npm run build --workspace @portalai/core` (a full `npm run build` if unsure) — `apps/*` resolve `@portalai/core` from its `dist/`.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000).

### Fixtures

- [ ] **A queryable entity with > `HANDLE_ROW_CAP` (100,000) rows.** The connectors seeded this session work: the **Utah Roads** entity (413,311 rows) or **LIR parcels** (394,610), on the `GIS smoke` station. (Any entity/table over 100k does — this is *tabular* row-count, independent of geometry.) Note the true count for the assertions below (e.g. roads = 413,311).
- [ ] *(Back-compat check)* a result **under** 100k (any small entity, or a filtered query) for the exact-count case.

### Reset between runs

- [ ] No reset needed — read-only. Re-run by re-issuing the prompt/query.

## §1 — Data table shows the true total, not 100,001 (AC1, AC3)

- [ ] Ask for a large **tabular** result (not a map): e.g. *"list all Utah Roads as a table"* or an `sql_query` like *"select fullname, cartocode from the roads"* — anything that returns > 100k rows and renders as a data table.
- [ ] Expected notice above the table: **"Showing the first 5,000 of 413,311 rows."** — the **true total** (e.g. 413,311), **not** `100,001` and **not** `100,001+`.
- [ ] Expected, same notice: **"analysis ran on the first 100,000"** (since the match exceeds the 100k staging cap) — **not** "All 413,311 were analysed" (which would be false).
- [ ] The truncation "+" is **absent** for the exact count (the true total is known), present only if the exact count could not be computed (see §4).

## §2 — d3 chart shows the true total (AC1)

- [ ] Ask for a chart over a > 100k-row result: e.g. *"chart the count of roads by cartocode"* in a way that stages a large handle (or *"plot fullname vs …"* over the raw roads).
- [ ] Expected progress caption while rendering: **"Rendering ⟨N⟩ of 413,311 rows…"** — the true total, not `100,001`.

## §3 — Small results + pre-#340 blocks unchanged (AC4)

- [ ] A result **under** 100k rows (e.g. a filtered `sql_query`) shows the **exact** count with **no "+"** and (for a capped display) "All ⟨N⟩ were analysed" as before — behavior is unchanged below the cap.
- [ ] *(If you have one)* open a map/chart/table widget **pinned before this branch** (no `matchedCount` in its stored content) — it still renders, falling back to `rowCount` (no error, no blank).

## §4 — Error & edge cases (AC2, AC5)

- [ ] **No crash / no hang** on the large query — the table/chart returns promptly; the `COUNT(*)` runs in the *same* transaction as staging (no second view build) and, if it ever hit the 30s `statement_timeout`, would degrade to the `100,000+` lower bound rather than failing the result. *(The timeout-fallback + same-txn behavior is asserted by the api unit/integration tests; the manually-observable proxy is "the large result still returns and shows a number.")*
- [ ] Sanity: `rowCount`/`truncated` semantics are unchanged — a previously-capped table that read `100,000+` still reads sensibly (now the true total when countable).

## Note — the map surface

`visualize_map` / `MapWidget` are on `epic/gis-toolpack`, not `main`, so they're **not** exercised here. They share the same handle envelope, so a tiled map's count corrects automatically when the epic next integrates this fix — verify there at that point, not on this branch.

## Sign-off

- [ ] Every section above verified
- [ ] ______________ (date + name) — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/station/entity ids · the true row count vs. what was shown):
