# tool-activity-indicator — Smoke Suite

Manual smoke test for [#279](https://github.com/EnterpriseBT/portal-ai/issues/279) — surfacing which tool is running while a portal turn is pending. Covers the two new SSE events (`tool_call` / `tool_call_end`), the per-tool phase label with its name-derived fallback for custom tools, the inline feed indicator that now stays mounted for the whole turn, the overlay strip above the composer, and the OpenAPI sync of all six stream events.

**Branch under test:** `feat/tool-activity-indicator` (PR [#305](https://github.com/EnterpriseBT/portal-ai/pull/305)).

Run **§Preflight** once before any section. The rest can be walked top-to-bottom; each section is independent after preflight.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section in the issue body (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/tool-activity-indicator && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core` — **required.** `@portalai/core` gained the two event schemas and the `tool-phase-labels` registry; the API and web dev servers resolve core through its `dist`, so a stale build means the label lookup is missing at runtime even though tests pass (they map to source).
- [ ] **No migration.** This ticket adds no table, column, or enum — nothing to run, nothing to roll back.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).
- [ ] Auth0 dev tenant works — login lands on `/dashboard`.

### Fixtures

| Alias | Shape | Used by |
|---|---|---|
| **big-entity** | A station entity with enough rows that a query + chart takes visibly more than ~2s (the NEO fixture from `LARGE_DATA_OPS.smoke.md` §Preflight works). Needs at least one numeric column. | §1, §2, §3, §6 |
| **toolpacks** | The station has **`data_query`** + **`visualize`** enabled (for `sql_query` → `visualize_d3`), and **`statistics`** for §4a. | §1–§4 |
| **custom pack** *(optional — see §4b)* | An org toolpack registered via Settings → Toolpacks with a reachable webhook endpoint and at least one snake_case tool name. | §4b |

### Reset between runs

- [ ] No reset needed — this feature persists nothing. Each turn starts from an empty step set.
- [ ] If a previous turn was interrupted, reload the portal session before the next section (also the check in §5d).

---

## §1 — Happy path: the gap this ticket closes

- [ ] Open a portal session on the **big-entity** station.
- [ ] Prompt: **"Chart the distribution of <numeric column> as a bar chart."**
- [ ] **Immediately after sending**, the three-dot indicator appears in the feed (unchanged pre-first-token behavior).
- [ ] Once the assistant's opening text streams in (e.g. "Let me chart that for you"), the indicator **does not disappear** — it stays mounted and now reads a phase label. *This is the bug: before this change the feed froze here until the finished chart appeared.*
- [ ] While the query runs the label reads **"Querying your data"** (the curated copy for `sql_query` — **not** the raw tool name `sql_query`).
- [ ] The elapsed counter beside the label **increments once per second** (`1s`, `2s`, `3s`…), continuously, with no visible stall.
- [ ] When the chart step begins, the label changes to **"Building the chart"** (`visualize_d3`).
- [ ] The moment the chart block renders, **both** the inline indicator and the strip disappear.

## §2 — The two surfaces hand off (never both at once)

The strip and the inline indicator carry identical text, so they are **mutually exclusive**: the strip covers only the case the inline one can't — the feed scrolled away from the bottom.

- [ ] Re-run the §1 prompt. While a tool is running and the feed is at the **bottom**, only the **inline** indicator shows. There is **no** pill above the composer — the same phase is not on screen twice.
- [ ] While the tool is still running, scroll the feed **up** so the inline indicator goes off-screen. The pill above the composer **appears**, showing the same label and elapsed seconds.
- [ ] Scroll back **down** to the bottom. The pill **disappears** again and the inline indicator is what remains.
- [ ] The hand-off in both directions does **not** move the composer or shift the feed (this is §6's concern, but watch for it here too).
- [ ] While scrolled up with the pill visible, click on message text *underneath* it — the click reaches the feed (text selects normally). The pill does not swallow the interaction.

## §3 — Multi-tool and concurrent turns

- [ ] Prompt something that chains tools, e.g. **"Cluster the records into 3 groups by <numeric column>, then chart the clusters."**
- [ ] The label **advances** as each tool starts — e.g. "Querying your data" → "Clustering records" → "Building the chart".
- [ ] No **stale** label: at no point does the label name a tool that has already produced its output.
- [ ] *(Opportunistic — the agent decides whether to parallelize.)* If a turn opens two tools at once, the surfaces show the **most recently started** one; when it finishes, the label falls back to the **still-running** older one rather than going blank. If you can't get the agent to parallelize, note it as unobserved rather than passing it.

## §4 — Tools that produce no chart, and custom tools

### §4a — A stats-only turn (no display block)

- [ ] Prompt a statistics question answered in prose, e.g. **"Is the mean of <numeric column> significantly different from <plausible value>? Run a hypothesis test."**
- [ ] While the test runs, the indicator shows **"Running the test"** (`hypothesis_test`) with a ticking counter.
- [ ] The indicator **clears when the reply completes**, even though the turn produced **no chart or table block**. *This is the regression the ticket names: `hypothesis_test` emits no `tool_result`, so before this change nothing would have closed the step.*

### §4b — A custom/webhook tool

*Requires a registered custom toolpack. If you have no webhook endpoint handy, this criterion cannot be walked — mark it **unverified** rather than passing it.*

- [ ] Prompt something that invokes a tool from your custom pack.
- [ ] While it runs, the indicator shows a label **derived from the tool's name** — e.g. a tool named `refresh_crm` reads **"Running refresh crm"**.
- [ ] The label is **never blank**, and it is derived from the tool **name**, not from its description text.

## §5 — Termination paths

Each of these must clear **both** surfaces.

### §5a — Cancel

- [ ] Start a long turn (§1 prompt). While a tool is running, press **Cancel**.
- [ ] Both the inline indicator and the pill disappear **immediately**.

### §5b — Stream error

- [ ] Start a long turn, then kill the API (`Ctrl-C` in the `npm run dev` API pane) while a tool is running.
- [ ] Both surfaces clear, and the existing connection-error `StatusMessage` is what remains in the feed.
- [ ] Restart the API before continuing.

### §5c — Completion leaves no trace

- [ ] After any completed turn, scroll back through the transcript. There is **no** activity trail, step history, or expander anywhere — the rendered blocks are the only record.

### §5d — Reload mid-turn

- [ ] Start a long turn and, while a tool is running, **reload the browser**.
- [ ] The session loads with **no phantom indicator** and no pill. (Nothing is persisted, so there is nothing to rehydrate.)

## §6 — No layout shift *(the criterion tests can't cover)*

The jsdom tests prove the strip is absolutely positioned and lives outside the composer box. They **cannot** prove the absence of a visual jump — that is this section.

- [ ] Start a long turn. Watch the **composer's text input**: it must **not move** vertically when the pill appears or disappears.
- [ ] Type into the input **while a tool is running**. The pill appearing mid-keystroke does not move the caret, resize the field, or interrupt typing.
- [ ] With the feed scrolled to the bottom, watch the message area as the pill appears: the feed does **not** jump, re-scroll, or shift its content.
- [ ] Scroll to a specific message mid-feed while a tool runs. Your scroll position **holds** — it is not yanked to the bottom when the pill mounts or unmounts.

## §7 — Accessibility

- [ ] With a screen reader (VoiceOver: ⌘F5 on macOS), start a turn with tools.
- [ ] Each **phase change** is announced once — e.g. "Querying your data", then "Building the chart".
- [ ] The **elapsed counter is not announced** — there is no per-second chatter. (The counter is `aria-hidden`; only the phase reaches the live region.)

## §8 — API contract & docs

- [ ] Open `http://localhost:3001/api/docs` (the Swagger UI; raw spec at `/api/docs/spec`).
- [ ] The portal stream is listed under **`/api/sse/portals/{portalId}/stream`** — its real mounted path. The old `/api/portals/{portalId}/stream` entry is **gone**. *(It documented an endpoint that never existed.)*
- [ ] Its 200 response references **`PortalStreamEvent`**, and the schema list includes all six: `PortalDeltaEvent`, `PortalToolCallEvent`, `PortalToolCallEndEvent`, `PortalToolResultEvent`, `PortalDoneEvent`, `PortalStreamErrorEvent`.
- [ ] The route description names all six event types, and `tool_result`'s field reads **`toolName`** (it previously said `name`, which was wrong).
- [ ] *(Optional, wire-level.)* With DevTools → Network → the `/stream` request → **EventStream** tab, confirm `tool_call` and `tool_call_end` events appear with matching `toolCallId` values, and that a `hypothesis_test` turn (§4a) emits `tool_call_end` with **no** accompanying `tool_result`.

---

## Sign-off

- [ ] Every section above verified (or explicitly marked unverified with a reason — §3 parallel case, §4b custom pack)
- [ ] ______________________ (date + name) — confirmed against my own running stack

---

## Bug-filing template

```
Section:            §<n> — <name>
Expected:           <what the checklist said>
Got:                <what actually happened>
Repro:              <exact prompt / clicks / commands>
Identifiers:        org / station / portal / entity ids
Console + network:  <errors; the EventStream frames if wire-related>
```
