# visualize_d3 — Smoke Suite

Manual smoke test for [#269](https://github.com/EnterpriseBT/portal-ai/issues/269) — the `visualize_d3` agent tool: intent-in (`{ sql, instruction, title? }`), a dedicated `claude-opus-4-8` codegen sub-call synthesizes the D3 program, validate-and-retry with a data-table fallback, minted as a `d3` block that #268's sandbox renders. Own `visualize` pack, `expensive`-cost-classed. **Branch under test:** `feat/visualize-d3-tool` (PR [#275](https://github.com/EnterpriseBT/portal-ai/pull/275), base `epic/d3-dashboard-widgets`).

Unlike #268 (which hand-injected `d3` blocks), this ticket has a real producer — drive it with **actual chart prompts** in a portal session. It makes a live Opus API call per chart, so expect a visible pause and real token cost.

Run **§Preflight** once; sections are independent afterwards. File bugs with the template at the bottom.

## Walk status (2026-07-24)

- **§1 render path — VERIFIED.** A `visualize_d3` call produced a valid ~2KB D3 program (idempotent `clear → redraw` reading `api.data`), inline-bound, rendered in the `allow-scripts` sandbox iframe. The tool's core machinery works end-to-end.
- **Finding 1 — tier rows must allowlist `visualize` on deploy (recorded in Preflight).** Fixed locally as a `tier apply` stand-in.
- **Finding 2 — autonomous chart routing is unreliable during coexistence.** With the Vega `visualize`/`visualize_tree` tools still present (removed only in #272), `claude-sonnet-4-6` routes a natural "chart X" prompt to `sql_query` (table) or the Vega `visualize`, not `visualize_d3` — even after strengthening the Charting guidance. `visualize_d3` renders correctly when selected (explicitly, or once it's the sole chart tool). **The full feature-level smoke (§2–§5) is deferred to the #272 / epic-level smoke**, where `visualize_d3` is the default chart path. #269's own tool is verified via the render path above + its unit suites; AC1 ("chart prompt → `visualize_d3`") is an epic-level acceptance once #272 lands.

## Preflight

### Environment

- [ ] `git checkout feat/visualize-d3-tool && git pull --ff-only`
- [ ] `npm install` — no new dependency (validation uses `new Function`); no migration.
- [ ] `ANTHROPIC_API_KEY` is set in the API env and can reach **`claude-opus-4-8`** (the codegen model) — the tool fails its call without it.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`); login lands on `/dashboard`.
- [ ] This branch is based on `epic/d3-dashboard-widgets`, so #268's sandbox renderer is present — a `d3` block will actually render.

### Fixtures

- [ ] **Station with the Visualize pack enabled.** On your test station, enable the **Visualize** toolpack (Station → tool packs). Keep **Data Query** enabled too (typical; the agent needs schema/SQL context).
- [ ] **Tier rows allowlist `visualize` (deploy requirement — surfaced by this walk).** Entitlement resolves from the DB `tiers` table, not the catalog code. A newly-shipped pack is fail-closed invisible to **every** org until a tier row lists it (the API logs `[seed] Built-in toolpack slug(s) not listed by any tier row: visualize …` at boot). The catalog code already grants it to `pro`/`enterprise` (slug spread), so **`portalops tier apply --env <env>` must run on deploy** to re-provision the tier rows — this is a required step for app-dev/prod, not just local. Locally, run `tier apply` (rebuild the CLI first — its dist predates the pack) or, as a stand-in, add `"visualize"` to the `pro`/`enterprise` rows' `builtin_toolpacks`. Allow ≤60s for `TierService`'s policy cache to refresh after the change.
- [ ] **Org tier entitles `visualize`.** Only `pro`/`enterprise` allowlist it (`standard`/`plus` do not — it's an `expensive` tool). Confirm your dev org is on such a tier (local dev typically resolves "Pro"). If `visualize_d3` never appears even with the pack enabled, check this and the tier-row step above.
- [ ] **A small entity (≤100 rows)** for the inline path and **a large entity (>100 rows)** for the handle path — e.g. the `sheet_0_smoke_sales` fixture (1,460 rows) covers the handle case; a small aggregate covers inline.

### Reset between runs

- [ ] Read-mostly — `visualize_d3` writes nothing durable beyond the assistant message it produces. To declutter, delete test portal sessions, or start a fresh session per run.
- [ ] `npm run db:studio` (from `apps/api/`) — to inspect `portal_messages.blocks` (the persisted `d3` / `tool-call` blocks) and the `usage` table (expensive-class metering).

---

## §1 — Happy path, inline (≤100 rows) (AC: renders end-to-end; inline threshold; agent supplies intent)

- [ ] In a portal session on the fixture station, prompt: **"Chart total revenue by month for the smoke sales as a bar chart."** (adapt to your small/aggregate data).
- [ ] The agent calls **`visualize_d3`** — inspect the tool-call panel (or `portal_messages.blocks` → the `tool-call` block): its `input` has `sql` + a natural-language `instruction`, and **no `d3Program`/`spec`** (the agent describes intent; it does not write the program).
- [ ] After a short pause (the Opus codegen call), an interactive D3 chart renders inline in the session — themed (brand colors), inside the sandboxed iframe (`<iframe title="D3 visualization">`, `sandbox="allow-scripts"`).
- [ ] Reload the page → the same chart re-renders from the persisted `d3` block (not just a live-stream artifact).

## §2 — Happy path, handle (>100 rows) (AC: handle path; rows never in agent context; progressive render)

- [ ] Prompt against the large entity: **"Plot every individual smoke sales record as a scatter of quantity vs. amount."** (must exceed 100 rows → the query-handle path).
- [ ] The rendered `d3` block's content carries a `queryHandle` (inspect `portal_messages.blocks`), **not** inline rows — confirm the agent's context/tool-result envelope shows `rowCount`/`schema`/`samplePeek`, never the full row set.
- [ ] The widget paints progressively (first batch, then grows) and stays responsive — the #268 runtime behavior, now fed by a real handle.

## §3 — Agent routing + codegen contract (AC: reaches for visualize_d3; guidance/mirror agree)

- [ ] With both `data_query` and `visualize` enabled, a chart prompt routes to **`visualize_d3`**, not the legacy Vega `visualize` — the system prompt's Charting section steers there. (If it picks `visualize`/vega instead, that's a prompt-tuning finding — file it; #272 removes the Vega tools, but until then the guidance should win.)
- [ ] The **Visualize** pack appears as its own pack (separate from Data Query) in the toolpack metadata modal, with the `visualize_d3` tool and its description; the description matches the tool's agent-facing `description` (no drift).
- [ ] (Optional, if API request logging is on) The codegen call's prompt contains the column **schema + a ≤10-row sample**, never the full dataset — confirming rows don't bloat the codegen input. Otherwise this is covered by unit test 9.
- [ ] Help → glossary "Tool" entry: its example names **`visualize_d3`** (rendering the result as an interactive chart), not the old `visualize` — the user-facing doc-sync.

## §4 — Pack gating + expensive metering (AC: own pack; expensive; independent entitlement)

- [ ] On a station **without** the Visualize pack enabled, a chart prompt does **not** call `visualize_d3` (the tool isn't offered) — confirms pack-level gating.
- [ ] In `db:studio` → `usage` (or Settings → Organization usage), note the **`expensive`** class balance, run one chart via §1, and confirm the expensive usage **incremented** — the per-call Opus cost is metered through the gate (#169). Compare to `sql_query` (a `free` tool) which does not increment it.
- [ ] (If your dev org can switch tiers) On a `standard`/`plus` tier, `visualize_d3` is **not** entitled/offered even with the pack enabled; on `pro`/`enterprise` it is — confirms independent tier-gating.

## §5 — Failure paths (AC: compile-retry never re-prompts; data-table fallback)

- [ ] **Compile-retry and data-table fallback are primarily unit-verified** (tool tests 11–13: parse-fail → retry with error fed back; all-fail → data-table fallback; provider error → typed result). They are hard to force from a healthy Opus model manually.
- [ ] **Optional forced check — data-table fallback:** temporarily point `AiService.CODEGEN_MODEL` at a bogus model id (or otherwise make codegen return non-JS), prompt a chart, and confirm the session shows a **data table** of the query result plus the relay message ("Couldn't generate the visualization; showing the query result as a table.") — never an error dead-end, never a re-prompt. Revert the change after.
- [ ] **Optional forced check — provider error:** unset/blank `ANTHROPIC_API_KEY` (or block the model), prompt a chart, and confirm the agent relays a graceful failure (typed `VISUALIZE_D3_CODEGEN_FAILED`), not a crash. Restore after.

## Sign-off

- [ ] CI green on PR #275 (unit suites cover the remaining acceptance criterion: lint/type-check/tests — core 1429, api 1927, web 2481 locally).
- [x] §1 render path verified (see Walk status); §2–§5 deferred to the #272 / epic-level smoke per Finding 2.
- [x] 2026-07-24 Ben Turner — render path confirmed against my own running stack; autonomous chart routing deferred to #272 (vega removal is the structural fix).

## Bug-filing template

Section: · Expected: · Got: · Repro (prompt + station/tier): · Identifiers (org/portal/message ids):
