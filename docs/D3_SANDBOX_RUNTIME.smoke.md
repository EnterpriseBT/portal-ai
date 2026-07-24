# d3-sandbox-runtime — Smoke Suite

Manual smoke test for [#268](https://github.com/EnterpriseBT/portal-ai/issues/268) — the sandboxed D3 render runtime: `d3` block contract, `allow-scripts`-only iframe with a no-egress CSP, nonce-validated postMessage bridge, progressive batch rendering, error containment, and the open-registry renderer. **Branch under test:** `feat/d3-sandbox-runtime` (PR [#274](https://github.com/EnterpriseBT/portal-ai/pull/274), base `epic/d3-dashboard-widgets`).

**Producer note:** no tool mints `d3` blocks until #269, so in-app sections inject blocks by appending to `portal_messages.blocks` (exact SQL below, dollar-quoted — paste as-is into `db:studio`'s SQL console or psql). Storybook (§7) is the standalone execution surface.

Run **§Preflight** once; sections are independent afterwards. File bugs with the template at the bottom.

---

## Preflight

### Environment

- [x] `git checkout feat/d3-sandbox-runtime && git pull --ff-only`
- [x] `npm install` — this branch adds the `d3@7.9.0` (exact) dependency to `apps/web`.
- [x] No migration — this branch has **no** DB or API change.
- [x] `npm run dev` boots cleanly (API `:3001`, web `:3000`); login lands on `/dashboard`.

### Fixtures

| Alias | Shape | Used by |
|---|---|---|
| **portal** | Any portal session with at least one assistant reply (a text block to compare pin behavior against). | §1, §2, §5, §6 |
| **bigdata** | A station entity with **> 1,000 rows** (the NEO fixture works) so a `visualize` prompt produces a query handle with multiple 1,000-row pages. | §4 |

### Reset between runs

- [x] Injected `d3` blocks are removed with (replace the id; run per polluted message):
  ```sql
  UPDATE portal_messages
  SET blocks = COALESCE(
    (SELECT jsonb_agg(b) FROM jsonb_array_elements(blocks) b WHERE b->>'type' <> 'd3'),
    '[]'::jsonb)
  WHERE id = '<message-id>';
  ```
- [x] Otherwise read-only — nothing else to reset.

---

## §1 — No regression on existing renderers (AC: registry untouched)

- [x] Open the **portal** session. Existing **text** blocks render as before (markdown intact).
- [x] Prompt: **"show me a table of <any entity>"** — the data-table block renders as before.
- [x] Prompt: **"visualize <something small>"** — the Vega chart renders as before (Vega tools are untouched by this branch; removal is #272).
- [x] Hovering a text / data-table / vega block still shows the **pin** affordance.

## §2 — Inline `d3` widget renders in a session (AC: sandbox attrs; AC: registry; AC: no pin)

- [x] Find a target message: `SELECT id, portal_id, created FROM portal_messages WHERE role='assistant' ORDER BY created DESC LIMIT 5;` — pick one from the **portal** session.
- [x] Inject an inline `d3` block:
  ```sql
  UPDATE portal_messages SET blocks = blocks || $blk$[
    {"type":"d3","content":{
      "title":"Smoke: inline bars",
      "program":"var s=api.d3.select(api.container).append('svg').attr('width',320).attr('height',140); s.selectAll('rect').data(api.data).join('rect').attr('x',function(d,i){return 10+i*75;}).attr('y',function(d){return 130-d.v;}).attr('width',65).attr('height',function(d){return d.v;}).attr('fill',api.theme.categorical[0]);",
      "rows":[{"v":40},{"v":90},{"v":60},{"v":120}]
    }}
  ]$blk$::jsonb WHERE id = '<message-id>';
  ```
- [x] Reload the session. The message now shows **"Smoke: inline bars"** and four purple bars rendered inside the widget.
- [x] DevTools → Elements → select the widget's `<iframe title="D3 visualization">`: its `sandbox` attribute is **exactly `allow-scripts`** (no `allow-same-origin`), and `srcdoc` starts with `<!doctype html>` containing the `Content-Security-Policy` meta.
- [x] Hovering the d3 block shows **no pin icon**; hovering the sibling text block still does.

## §3 — Containment probes (AC: no egress; AC: no storage/token/app reach)

With the §2 widget on screen, open DevTools → Console and switch the context dropdown (top-left of the console) to the **"D3 visualization"** frame. Run each probe **inside the frame context**:

- [x] `fetch("https://example.com")` → rejects; console logs a CSP violation (`Refused to connect … default-src 'none'`). Network tab shows **no** outgoing request.
- [x] `new Image().src = "https://example.com/x.png"` → CSP violation, no network request.
- [x] `new WebSocket("wss://example.com")` → throws / CSP violation, no connection attempt.
- [x] `document.cookie` → throws (`SecurityError`) or returns `""` — never the app's cookies.
- [x] `window.localStorage` → throws (`SecurityError` — opaque origin has no storage).
- [x] `window.parent.document` → throws (`SecurityError` — cross-origin frame access blocked).
- [x] After all probes: the app is unaffected — the session still scrolls, other blocks still render, no app-console errors beyond the CSP violation reports.

## §4 — Progressive handle rendering (AC: first-batch paint, growth, responsiveness)

- [x] Prompt against **bigdata**: **"visualize <the large dataset>"** (must exceed 1,000 rows). The Vega chart renders via the handle path (this creates the Redis handle the d3 block will reuse — do the next steps the same day; handles expire in 24 h).
- [x] In `db:studio` → `portal_messages`, open that reply's `blocks` and copy the vega-lite block's envelope fields (`queryHandle`, `rowCount`, `schema`, `sampled`, `sampleSize` if present, `truncated`, `samplePeek`, `sql`). Inject a handle-backed `d3` block onto the same message, pasting those fields verbatim:
  ```sql
  UPDATE portal_messages SET blocks = blocks || $blk$[
    {"type":"d3","content":{
      "title":"Smoke: progressive count",
      "program":"api.d3.select(api.container).append('div').style('font-family',api.theme.fontFamily).style('padding','8px').text('rows received: '+api.data.length);",
      "queryHandle":"<paste>", "rowCount":<paste>, "schema":<paste>,
      "sampled":<paste>, "truncated":<paste>, "samplePeek":<paste>, "sql":<paste>
    }}
  ]$blk$::jsonb WHERE id = '<message-id>';
  ```
- [x] Reload the session. The widget shows **"Loading N rows…"** briefly, then paints **"rows received: 1000"** (the first page — it does *not* wait for the full set), with a **"Rendering X of N rows…"** caption below.
- [x] The count climbs in ~1,000-row steps to the full row count; the caption disappears when complete.
- [x] While batches stream in, scrolling and typing in the session stay responsive (no frozen frames).

## §5 — Error containment (AC: throw/compile/timeout → error card, siblings unaffected)

- [x] Inject a **throwing** program onto a message that also has a text block:
  ```sql
  UPDATE portal_messages SET blocks = blocks || $blk$[
    {"type":"d3","content":{"program":"throw new Error('intentional smoke failure');","rows":[{"v":1}]}}
  ]$blk$::jsonb WHERE id = '<message-id>';
  ```
  Reload: the widget area shows the error card — **"Visualization failed to render: intentional smoke failure"** — and the sibling text block renders normally.
- [x] Inject a **compile-error** program (`"program":"this is not javascript"` with `"rows":[]`): reload → error card with the syntax error message; session unaffected.
- [x] Timeout path (a program that never completes) is covered by the bridge unit test (10 s watchdog). Optional manual variant: `"program":"while(true){}"` — expect the error card after ~10 s; the tab may jank until the watchdog fires (known limit — spec Key decision 7).

## §6 — Expired handle (AC: expired-cache message)

- [x] Inject a handle block with a dead handle:
  ```sql
  UPDATE portal_messages SET blocks = blocks || $blk$[
    {"type":"d3","content":{
      "program":"api.d3.select(api.container).append('div').text('should not render');",
      "queryHandle":"qh-smoke-expired","rowCount":5000,"schema":[],
      "sampled":false,"truncated":false,"samplePeek":[],"sql":null
    }}
  ]$blk$::jsonb WHERE id = '<message-id>';
  ```
- [x] Reload: the widget shows **"The chart's data has expired from cache. Re-run the original query to refresh."** (the refresh affordance itself is #270).

## §7 — Storybook (real-browser execution surface)

- [x] `cd apps/web && npm run storybook` → `:7007` → **Modules/D3Widget**.
- [x] **Rendered** — a live D3 bar chart paints inside the frame (brand purple bars, axes).
- [x] **DarkTheme** — same chart with dark background/text tokens.
- [x] **Loading** — spinner with **"Loading 13,427+ rows…"** (the `N+` truncation label).
- [x] **ProgressiveRendering** — chart plus **"Rendering 6,000 of 13,427+ rows…"** caption.
- [x] **ErrorCard** — the monospace error card, no iframe.
- [x] **ThrowingProgram** — the frame reports the throw: the Storybook **Actions** panel logs `onFrameError` with `intentional sandbox failure`; the Storybook page itself keeps working.

---

## Sign-off

- [x] CI green on PR #274 (unit suites cover the remaining acceptance criterion: lint/type-check/tests).
- [x] Every section above verified.
- [x] <date> <name> — confirmed against my own running stack.

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/portal/message ids):
