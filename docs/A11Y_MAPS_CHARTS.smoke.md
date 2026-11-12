# A11Y_MAPS_CHARTS — Smoke Suite

Manual smoke test for [#796](https://github.com/EnterpriseBT/portal-ai/issues/796): accessible maps and charts.
- **Charts and maps as figures:** each is a figure with an agent-written summary.
- **Show data:** a "Show data" button opens a paged table of the chart or map's data.
- **Map keyboard access:** a key hint, "Features in view", feature highlighting, and count announcements.
- **Stable tile ids:** tiles carry a stable feature id.

**Branch under test:** `feat/796-a11y-maps-charts` (PR [#1015](https://github.com/EnterpriseBT/portal-ai/pull/1015), into `epic/a11y-conformance`).

**How to read it:**
- Run **§Preflight** once; after that each section stands alone.
- Steps tagged `— manual` need a human: screen-reader output, visual judgement, or a real keyboard on a real map.
- Steps tagged `— backend` need a CLI, Redis or DB action.
- Everything else is agent-walkable with `/smoke-walk`.
- Every box starts unchecked; checking them is your confirmation.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, and link this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/796-a11y-maps-charts && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`. Core gained `deriveVisualSummary`, `DataTableBlock`'s `paging` and theme rules, and the API and web read its dist. If the API is already running, touch an `apps/api/src` file so nodemon reloads core. **No migration**: `summary` lives in block content (jsonb), and the tile feature id is computed per tile.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).

### Fixtures

The walkthrough uses the demo org (Harborview Supply Co., `docs/DEMO_ORG.runbook.md`). Its dataset covers every path:
- monthly revenue: a small **inline** chart;
- ~1M transactions: a large **handle** chart that runs past the 100,000-row cap;
- a few distribution centres: an **inline** map;
- hundreds of customers: a **tiled** map.

- [ ] Local demo org exists — `backend`:
  - `npx portalai seed org --name demo --env local --yes`
  - `npx portalai org set-tier <orgId> demo --env local --yes`
  - `npx portalai demo seed --env local --org <orgId> --yes`
  - Skip if you already have it; `npx portalai demo reset --env local --org <orgId> --yes` puts it back to the checked-in state.
- [ ] You're signed in to that org, and its station has the **data_query**, **visualize** and **gis** toolpacks enabled.
- [ ] An existing portal session with a chart and a map created **before** this branch (or on `main`), for §1d. If you have none, see §1d's backend fallback.

### Reset between runs

- [ ] No reset needed: every step only reads, except §5d (which removes a Redis handle; re-run the prompt for a fresh one) and §1d's optional backend edit.

---

## §1 — Charts and maps are named, described figures (slices 1–2)

### §1a — A small chart

- [ ] In a new portal on the demo station, prompt: **"Chart monthly revenue over the full history."**
- [ ] The agent calls `visualize_d3`. In the tool-call panel, its input includes a non-empty `summary` of 1–3 sentences naming the measure and a takeaway, not colours.
- [ ] The rendered chart is a **figure** (accessibility tree: `role="figure"`) named by the chart's title, with the summary visible as text under its header and set as the figure's description (`aria-describedby`).
- [ ] The chart's iframe has `title="<chart title> (chart)"`, not "D3 visualization".

### §1b — A map

- [ ] Prompt: **"Map our distribution centers."**
- [ ] `visualize_map` is called with a non-empty `summary`. The map renders as a figure named by its title and described by the visible summary.

### §1c — Pinned result detail

- [ ] Pin the §1a chart (pin action on the result), then open it from **Pinned Results**.
- [ ] On the pin's detail page the chart is again a figure named by its title and described by the **same** summary.

### §1d — A pre-#796 block falls back to a derived summary

- [ ] Open the existing session or pin from Preflight that holds a chart and a map made before this branch.
- [ ] Each still renders as a figure. Its visible summary is a **derived** one, e.g. `Chart: <title>. 24 rows; fields month, revenue.` or `Map: <title>. 12 features in 1 layer (points).`
- [ ] *Fallback if you have no pre-#796 block* — `backend`: in `npm run db:studio`, find the message holding a chart block and delete `summary` from that block's `content`. Reload: the derived summary shows.

### §1e — Offscreen placeholders stay named — manual

- [ ] In a long session with several charts, scroll a chart well out of view (its live iframe is torn down). With a screen reader's figure navigation (VoiceOver rotor or NVDA "list elements"), the placeholder is still listed as a figure with the chart's name. — manual

### §1f — The summary is required at the tool — backend

- [ ] The agent can't easily be made to leave out `summary`; the refusal path (`TOOL_INPUT_INVALID`, then a retry with a summary) is covered by `visualize-d3.tool.test.ts` / `visualize-map.tool.test.ts`. During this walk, check the API log for `TOOL_INPUT_INVALID` on any visualize call. If one occurs, the agent's next call in the same turn carries a summary. — backend

---

## §2 — Show data on a small chart and map (slice 3)

- [ ] On the §1a chart: a **Show data** button sits under the chart with `aria-expanded="false"`.
- [ ] Activate it: the label becomes **Hide data** (`aria-expanded="true"`, `aria-controls` → the region) and a region named **"Data for <chart title>"** appears.
- [ ] It holds a table named **"<chart title> data"** with the chart's rows, with client **search** and sortable headers (an inline result keeps both).
- [ ] On the §1b map: **Show data** opens its rows **without** a raw geometry column (no GeoJSON / WKB text). Lat/lng columns, if present, stay.
- [ ] **Hide data** collapses the region and removes the table.

---

## §3 — Show data on a large result (slice 3)

### §3a — Paged by offset

- [ ] Prompt: **"Chart every transaction's amount over time as a scatter plot."** This is a handle-backed chart over ~1M rows.
- [ ] Open **Show data**: the table shows the first page and a pagination bar reading `1–10 of 100,000` (digit-grouped). There is **no** search box and the headers **aren't** sortable.
- [ ] Above the table: **"Showing the first 100,000 of 1,0xx,xxx rows."**, or **"… of at least N rows."** when the count is a lower bound. It never repeats the staged number twice.
- [ ] Click **Next page**, then jump far ahead (e.g. set rows per page to 100 and page forward repeatedly). Each page loads in about as long as the first. In the browser network panel each page is one `GET /api/portal-sql/handle/<id>?offset=…&limit=…`.

### §3b — The table follows the widget's live data

- [ ] Click the chart's **Refresh**. Once it re-renders, **Show data** opens at page 1 again, with a request to the **new** handle id.

### §3c — A chart that failed to render still offers its data

- [ ] Prompt something the codegen tends to fail on, e.g. **"Chart revenue as a 3D rotating globe."**
  - The agent falls back to a table (no summary, expected), or renders a chart whose frame errors.
  - If the frame errors ("Visualization failed to render: …"), **Show data** is still under it and opens the rows.
  - If you can't produce a frame error, mark this step `could-not-automate`; the unit test `still offers the data when the chart failed to render` covers it.

### §3d — An expired handle offers Refresh — backend

- [ ] From §3a's network panel, copy the handle id. — backend
- [ ] `docker exec portalai-redis-1 redis-cli --scan --pattern 'portal-sql:handle:<id>*' | xargs -r docker exec -i portalai-redis-1 redis-cli del` — backend
- [ ] Back in the page, collapse and reopen **Show data**. It shows **"This data has expired. Refresh to load it again."** with a **Refresh** button and no table. Click **Refresh**: the chart reloads and **Show data** works again.

---

## §4 — Inspect a map from the keyboard (slice 4)

### §4a — Canvas name and key hint

- [ ] On the §1b map, the canvas (`.maplibregl-canvas`) has `aria-label="Map: <map title>"` and `aria-describedby` pointing at the visible caption **"Arrow keys pan, + and − zoom, when the map has focus."**

### §4b — Keyboard pan and zoom — manual

- [ ] With the keyboard only: **Tab** to the map canvas and see a visible focus ring. **Arrow keys** pan, and **+** / **−** zoom. — manual
- [ ] With a screen reader on, focusing the canvas reads its name and the key hint. — manual

### §4c — Features in view

- [ ] Under the map: a heading **"Features in view (N)"** (an `h3`), then a list of buttons, one per distribution centre, each labelled from the popup template or the first three fields.
- [ ] **Tab** into the list and press **Enter** on an item: the feature's popup opens on the map, the item reports `aria-pressed="true"`, and the feature is visibly highlighted (thicker outline or stroke). — manual (visual)
- [ ] Press **Escape**: the popup closes, the highlight clears, `aria-pressed` returns to `false`, and **focus is back on that list item**.
- [ ] Open an item again, then **click elsewhere on the map** with the mouse. The popup closes, but focus does **not** jump to the list.

### §4d — Count announcements

- [ ] On first load the map announces **nothing**. The hidden status region (`role="status"`) under the map is empty.
- [ ] Pan or zoom the map, then wait ~½ s. The status region reads **"N features in view"** and the heading's count matches.

### §4e — A large, tiled map

- [ ] Prompt: **"Map all our customers, colored by segment."** This is a handle-backed map over hundreds of points, rendered as vector tiles.
- [ ] "Features in view" lists **one item per customer** in view, not one per segment. Its count matches the points drawn, and each label ends with `· <segment column>: <value>`.
- [ ] In the network panel, the `.mvt` tile responses decode (MapLibre renders them) with no errors in the console.
- [ ] Pick a customer from the list: its point is highlighted on the map. That shows the tile carries a feature id. — manual (visual)
- [ ] Zoom far out until points aggregate into bins. The list shows only individual features still drawn, not the bins. If nothing individual is drawn, the heading reads **"Features in view (0)"** and **"No features in view."**
- [ ] If over 200 features are in view, the list ends with **"and N more. Zoom in to list them."**

---

## §5 — Colour meaning as text

- [ ] On §4e's map, the **legend** names every segment. Each "Features in view" label carries the segment value. **Show data** has the segment column.
- [ ] Ask for a gradient: **"Map our customers colored by lifetime revenue as a smooth gradient."** The legend shows the gradient's min and max as numbers, and the list labels carry each customer's revenue value.

---

## §6 — Docs and copy

- [ ] **Help → Glossary**, *Visualization Widget*: mentions the written summary and **Show data**. *Map Visualization*: mentions **Features in view**.
- [ ] `docs/A11Y_AUDIT.md`: KB-09 starts with **Closed:** and cites #796's commits.

---

## §7 — Error and edge cases

- [ ] **A zoom-expression width still renders** (the review regression). Prompt: **"Map our customers as points whose outline width grows as you zoom in."** If the agent's spec uses an expression `outlineWidth` (check the tool-call panel), the map renders with no "Invalid map style" error. If it doesn't use an expression, mark `could-not-automate`; `map-config.util.test.ts` covers it.
- [ ] **A pin before its data arrives.** Open a pinned map or chart from Pinned Results on a slow connection (DevTools → Slow 3G). Until its data arrives, the summary names the visual only (`Chart: <title>.`) and there's **no** Show data button. Both appear once it loads.
- [ ] **Axe, both themes.** On the portal page and a pin's detail page, run axe (browser extension or `@axe-core/playwright`) in light and dark with a chart's and a map's data **open**: no violations in the figures, tables or feature list.
- [ ] **Dark theme.** The summary, key hint, feature list and cap note are legible, with no new hard-coded colours. — manual (visual)

---

## §8 — Accessibility audit report — manual

- [ ] With the dev stack up, run `npm run --workspace @portalai/e2e e2e:seed`, `e2e:auth:all`, build and preview the marketing site on :3002, then run `npm run a11y:report`. The #796 section of `docs/A11Y_AUDIT.md` stays **empty**, and the summary's #796 keyboard / screen-reader count drops to **0** (KB-09 is closed). Commit the regenerated doc on this branch. The fixture org has no portal result, so this walk doesn't reach charts and maps; §1–§7 are the evidence for those. — manual
- [ ] Screen-reader pass, flow 3, steps 3 and 5 (`docs/A11Y_AUDIT.md` → Screen-reader pass). A chart is announced as a figure with its name and summary, and the pin's detail page announces it the same way. Walk it with VoiceOver + Safari or NVDA + Firefox. — manual

---

## Sign-off

- [ ] Every section above verified, or marked `could-not-automate` with the covering test named
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro (prompt or clicks): · Identifiers (org / station / portal / pin / handle id): · Browser + theme:
