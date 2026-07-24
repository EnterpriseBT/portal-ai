# Sandboxed D3 render runtime + `d3` block renderer — Discovery

**Issue:** [EnterpriseBT/portal-ai#268](https://github.com/EnterpriseBT/portal-ai/issues/268) (epic #267, branch base `epic/d3-dashboard-widgets`)

**Why this exists.** The epic replaces Vega/Vega-Lite with agent-authored **arbitrary D3 render programs** — which means the client will execute untrusted, LLM-generated JavaScript. The codebase has no sandbox infrastructure of any kind (no CSP anywhere: `apps/web/vite.config.ts` sets only a COOP header, `infra/cloudformation/frontend.yml:125` only ContentTypeOptions + COOP; no iframe/`srcdoc`/Worker usage in app code). This is the child that builds that containment: a sandboxed execution environment, the postMessage bridge into it, the `d3` block contract in core, and the renderer that plugs it into the existing block registry. Every other child in the epic renders through what this one ships.

## The current shape

### The block renderer registry

| Piece | Location | Note |
|---|---|---|
| `BlockRenderer` type | `packages/core/src/ui/ContentBlockRenderer.tsx:216` | `(block: PortalMessageBlock) => React.ReactNode`; renderer casts `block.content` internally |
| Renderer `Map` + seeds | `ContentBlockRenderer.tsx:298` | `text`, `vega-lite` (`:248`), `vega` (`:274`), `data-table` (`:285`), `mutation-result` (`:295`) hard-wired |
| `registerBlockRenderer` / `hasBlockRenderer` | `ContentBlockRenderer.tsx:314` / `:320` | **No production caller today** — only its test. The design comment at `:288–312` names `registerBlockRenderer("d3", …)` as the intended extension path |
| Lazy-load precedent | `ContentBlockRenderer.tsx:11,15` | `React.lazy(() => import("react-vega")…)` + `<Suspense>` |
| Error containment precedent | `ContentBlockRenderer.tsx:196` | `VegaErrorBoundary` class component, inline error message |

### Block content shapes

| Piece | Location | Note |
|---|---|---|
| `PortalMessageBlockSchema` | `packages/core/src/contracts/portal.contract.ts:44` | `{ type: string, content: unknown }` — open by design |
| `PortalBlockTypeSchema` | `portal.contract.ts:159` | enumerates block types; **no `d3` yet** — needs the addition |
| Reserved `"d3"` ResultKind | `packages/core/src/models/tool-capability.model.ts:78` | passive render label the registry dispatches on (doc comment `:70`) |
| `QueryHandleEnvelopeSchema` | `packages/core/src/contracts/portal-sql.contract.ts:24` | `queryHandle, rowCount, schema[], sampled, samplePeek, sql\|null` — canonical, but **not exported from the core barrel**; re-declared in `apps/api/src/services/portal-sql-handle.service.ts:30` and again as `QueryResultDataBlockContent` in web |
| Pinnable types | `packages/core/src/models/portal-result.model.ts:14` | `d3` deliberately **not** added (pin gating is #273) |

### Data arrival & routing for existing chart blocks

`PortalMessage.component.tsx:101` (`shouldRenderViaWeb`) routes handle-carrying `vega-lite`/`data-table` blocks to `QueryResultDataBlock.component.tsx`, which fetches the snapshot in **one shot** (`:124`, `sdk.portalSql.handleSnapshot`, offset 0 / limit 5000), rebuilds a synthetic inline block (`:90`, `:114`), and delegates back to `ContentBlockRenderer`. `READ_HANDLE_EXPIRED` is caught at `:143`. A handle-carrying `d3` block follows the same route — but note the store is already batch-grained: the handle service persists rows as 1000-row Redis batches (`apps/api/src/services/portal-sql-handle.service.ts`, `portal-sql:handle:<id>:batches:<n>`), and `getSnapshot` is paged (`offset`/`limit`), so progressive fetch needs no new server surface.

### What doesn't exist

- **No CSP, no `<iframe>`, no `srcdoc`, no blob URLs, no Workers** anywhere in `apps/web`/`apps/api`. The only `postMessage` is the OAuth popup (`apps/web/src/utils/oauth-popup.util.ts`) with an origin allowlist (`api-origin.util.ts`) — a validation pattern worth reusing.
- **`d3` is not a dependency** in any package.json.
- **No theme→chart bridge**: Vega specs pass through unthemed; themes live as JSON (`packages/core/src/assets/themes/brand-theme.json`) built into MUI themes in `ThemeProvider.tsx:23`. The iframe cannot inherit MUI context, so theme tokens must cross the bridge explicitly.
- Module Pattern exemplar for the new module: `apps/web/src/modules/RegionEditor/` (flat `*.component.tsx`, `utils/` with own `__tests__/`, top-level `__tests__/`, `stories/`, barrel `index.ts`).

## The design space

### Decision 1 — Containment host

**A. `srcdoc` iframe, `sandbox="allow-scripts"` only.** Static HTML document string with an in-document `<meta http-equiv="Content-Security-Policy">`. Omitting `allow-same-origin` gives the frame an opaque origin: no cookies, no storage, no app-origin fetch credibility. The CSP (`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'`) closes network egress: fetch/XHR/WebSocket (`connect-src`), image/font/media beacons, remote `import()`. Sandbox flags close forms, popups, top navigation.

**B. iframe to a static `sandbox.html` under `apps/web/public/`.** Same sandbox attribute; CSP could come via response headers. But dev (Vite) and prod (S3+CloudFront, `frontend.yml:125`) would both need per-path header configuration — new infra surface for no containment gain, since the opaque origin comes from the sandbox attribute either way.

**C. Web Worker.** No DOM — D3's SVG rendering doesn't work there without an OffscreenCanvas rasterization detour that forfeits interactivity. Not viable as the primary host.

| | A srcdoc | B static file | C worker |
|---|---|---|---|
| Network egress control | in-doc CSP meta, self-contained | response headers, needs Vite + CloudFront config | n/a (no DOM anyway) |
| Infra changes | none | dev + prod header plumbing | none |
| Testability | jsdom renders the iframe node; bridge mocked | same + asset serving in tests | poor for SVG |
| SVG/interactivity | full | full | no |

**Lean: A.** Self-contained, zero infra, and the containment properties (opaque origin + no-egress CSP + minimal sandbox flags) are identical to B without touching two serving stacks.

### Decision 2 — Provisioning D3 (and the program) into the frame

**A. Inline the D3 bundle text into the srcdoc** (Vite `?raw` import of the pinned `d3` dist bundle). The frame never loads anything over the network; CSP stays `default-src 'none'`.
**B. Serve D3 from our origin and allowlist that URL in the frame CSP.** Smaller srcdoc, but re-opens a network channel in the CSP, needs the allowlisted URL to be environment-aware, and adds the same dev/prod serving concerns as 1-B.
**C. CDN.** Violates the no-egress requirement outright.

| | A inline `?raw` | B self-hosted URL | C CDN |
|---|---|---|---|
| CSP | `default-src 'none'` holds | must allowlist script URL | broken |
| srcdoc weight | ~280KB (d3 v7 min) per mounted frame | small | small |
| Offline/dev parity | perfect | env-aware URL plumbing | none |

**Lean: A.** The weight is a per-mounted-frame memory cost, and the sibling child #271 bounds live frames; keeping the CSP at `default-src 'none'` is worth more than the kilobytes. The srcdoc string is built once (module-level constant) and reused across instances.

### Decision 3 — Program execution contract

**A. Fixed entrypoint, function-body source.** The block carries the *body* of a render function with a documented signature — inside the frame the bootstrap does `new Function("api", programSource)` and calls it with `api = { d3, container, data, params, theme, width, height }`. One shape for the agent to learn; the bootstrap owns lifecycle (clear container, invoke, observe size).
**B. ES module via `blob:` URL, default-export `render`.** More "real module" ergonomics (imports, top-level structure) but requires `script-src blob:` in the CSP and `URL.createObjectURL` availability in the opaque-origin frame — a wider CSP for marginal authoring benefit the agent doesn't need.
**C. Raw `<script>` injected verbatim.** No defined seam: the program grabs globals, lifecycle/error attribution gets murky, re-render on new data means full frame teardown.

**Lean: A.** Smallest CSP, cleanest error attribution (`try/catch` around one call), natural re-invocation on `data`/`resize` messages, and the fixed signature is exactly what #269's system-prompt guidance documents to the agent.

### Decision 4 — Renderer placement and registration

**A. Sandbox module in `apps/web/src/modules/` + `registerBlockRenderer("d3", …)` at web bootstrap.** Matches the issue and keeps core free of the srcdoc/bundling machinery (core can't do Vite `?raw` cleanly and shouldn't carry a 280KB text asset). First real use of the open registry — the registration call lives in a small init module imported by `main.tsx`.
**B. Bake into core beside the Vega renderers.** Automatic availability to any core consumer, but drags D3 + srcdoc building into core's build, and there is no non-web consumer of `ContentBlockRenderer` today.

**Lean: A.** Core gets only the Zod contract (+ exporting `QueryHandleEnvelopeSchema` from the barrel, fixing the noted duplication); web owns execution. Core's registry design note (`:288–312`) anticipated exactly this split.

### Decision 5 — Data delivery into the frame

**A. Everything over postMessage after a `ready` handshake.** srcdoc stays a static constant (bootstrap + D3 only); program source, rows, params, theme, and size arrive as an `init` message; subsequent `data`/`theme`/`resize` messages re-invoke the program without remounting the frame.
**B. Bake program + data into the srcdoc per instance.** No handshake, but srcdoc becomes per-instance (defeats reuse), large datasets bloat the DOM attribute, and updates force a full remount.

**Lean: A.** Static srcdoc, one protocol for initial render and refresh alike (what #270's refresh will reuse), and large-row delivery stays out of HTML attributes. The `data` message is **batched by design**: `data { rows, seq, done }` — the parent pages the snapshot endpoint and forwards each page as it lands, so the requirement that a large chart paints before the full set arrives falls out of the protocol rather than a special mode. Message validation follows the OAuth-popup pattern: `event.source === iframe.contentWindow` plus a per-instance nonce echoed in every message (an opaque-origin frame forces `targetOrigin: "*"`, so source+nonce is the authenticity check). Frame→parent messages: `ready`, `rendered { height, rowCount }` (emitted per batch), `resize { height }`, `error { message, stack? }` — a parent-side watchdog treats no `rendered`/`error` within a timeout as a hang and shows the error state.

### Decision 6 — Progressive render strategy (large datasets)

The amended PRD requires that a chart too large for one paint renders in batches — first batch visible without waiting for the full set.

**A. Accumulate-and-reinvoke in the bootstrap.** The frame's bootstrap buffers arriving batches and re-invokes the *same pure render program* with the full accumulated array (coalesced via `requestAnimationFrame` so several fast-arriving batches cost one repaint). The program stays a plain "render this data" function — the agent never learns a streaming API; D3's data-join makes full re-render cheap at these row counts.

**B. Expose a streaming API to the program** (`onBatch(rows)` / append semantics). Incremental appends could beat full re-joins on very large sets, but every agent-authored program must now correctly implement incremental state — a large new failure surface for LLM-generated code, and a second contract to document in #269.

**C. Single-shot render (status quo shape).** Fails the requirement outright for large results.

| | A accumulate + reinvoke | B streaming program API | C single-shot |
|---|---|---|---|
| Agent program complexity | unchanged (pure render fn) | high (stateful, easy to get wrong) | unchanged |
| First-paint latency | first batch | first batch | full dataset |
| Repaint cost | full re-join per coalesced batch | minimal appends | one paint |
| Contract surface for #269 | none added | new streaming contract | none |

**Lean: A.** Progressive display is the runtime's job, not the program's; the pure-render contract from Decision 3 is preserved exactly, and rAF coalescing keeps repaint cost bounded. If profiling ever shows re-join cost hurting at the cap, B can be added later as an opt-in capability without breaking A-shaped programs.

## Tradeoff comparison

| | D1: srcdoc iframe | D2: inline `?raw` D3 | D3: fixed entrypoint | D4: web module + bootstrap registration | D5: postMessage-only, batched | D6: accumulate + reinvoke |
|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes (the agent-facing contract) | Yes | Yes (the protocol) | Yes (paint semantics) |

## Recommendation

1. New module `apps/web/src/modules/D3Widget/` (RegionEditor shape): sandbox srcdoc builder + bridge in `utils/`, `D3WidgetUI` (pure: program/data/status props) + `D3Widget` container in the component file, tests + stories co-located.
2. The frame is a `srcdoc` iframe with `sandbox="allow-scripts"` (nothing else) and an in-document CSP of `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'` (`'unsafe-eval'` added during implementation — `new Function()` requires it; no network channel is opened); D3 v7 (new pinned dependency, `apps/web` only) inlined via `?raw` into a module-constant srcdoc.
3. Program contract: function-body source with signature `({ d3, container, data, params, theme, width, height })`, executed via `new Function` inside the frame's bootstrap; the bootstrap clears the container and re-invokes on `data`/`resize`/`theme` messages. Progressive rendering is bootstrap-owned: batches accumulate frame-side and re-invoke the pure program with the full array, coalesced per animation frame — the program never sees a streaming API.
4. Bridge protocol v1: parent→frame `init`/`data { rows, seq, done }`/`theme`/`resize`; frame→parent `ready`/`rendered { height, rowCount }`/`resize`/`error`; every message carries `{ v: 1, nonce }`; parent validates `event.source` + nonce; render watchdog timeout surfaces the error card.
5. Core changes: add `"d3"` to `PortalBlockTypeSchema` (`portal.contract.ts:159`); add `D3BlockContentSchema` (`program`, `title?`, `params?`, and data binding = inline `rows` **or** the query-handle envelope) composing `QueryHandleEnvelopeSchema`, which gets exported from the core barrel (deleting the api-service and web re-declarations is fair game in the same slice).
6. Renderer: `registerBlockRenderer("d3", …)` called from a web bootstrap init module; handle-carrying `d3` blocks added to `shouldRenderViaWeb` (`PortalMessage.component.tsx:101`). For the `d3` arm the container **pages** `handleSnapshot` (batch-sized requests, forwarding each page as a `data` message) instead of the single 5000-row fetch — first paint after page one, render status showing progress until `done`.
7. Theme tokens (categorical palette, fg/bg, font families — a small serializable set derived from the active MUI theme) cross the bridge in `init`/`theme`; the agent program receives them as `theme`.

## Open questions

All resolved with the issue author (2026-07-23):

1. **Full `d3` bundle or a trimmed module subset?** A subset shrinks the srcdoc but guesses wrong about what agent programs need (the whole point is expressiveness). **Resolved: full `d3` v7 default bundle, pinned exact.**
2. **Does the watchdog also bound post-render behavior** (e.g. a program that `setInterval`s forever)? A frame can't be CPU-limited from the parent. **Resolved: watchdog covers time-to-first-render only; a rendered-but-busy frame is bounded by #271's offscreen teardown. Stated as a known limit in the spec.**
3. **Re-render semantics on new data: re-invoke the program in place or rebuild the frame?** In-place re-invocation is cheaper and enables D3 transitions, but trusts the program's idempotence; the bootstrap clearing the container first makes it safe. **Resolved: re-invoke in place after container clear; full remount stays the error-recovery path.**
4. **Interactivity events out of the frame** (click→cross-filter). In-frame interactivity (tooltips, zoom, brushing) is self-contained D3 and works day one; this question is only about frame→app effects, which have no existing consumer. **Resolved: deferred — no message types reserved speculatively; when a real consumer arrives (dashboards epic), the versioned protocol adds an `interaction` message against actual requirements.**
5. **jsdom can't execute cross-frame scripts**, so bridge tests mock `contentWindow`/message events and srcdoc content is assert-by-string. Is a real-browser check needed pre-merge? **Resolved: unit tests against the mocked boundary + the smoke checklist's manual egress checks (devtools: blocked fetch/img requests); no new e2e infra in this child.**
6. **Row ceiling for progressive fetch.** Today's web path stops at 5000 rows; the handle retains up to 100k (sampled above 50k). **Resolved: page to what the handle retains, honoring its existing sampling semantics; the ceiling stays the handle service's, not a new client constant. The per-page size mirrors the 1000-row batch grain.**

## Enterprise-scale considerations

- **Concurrency & correctness** — N/A because the runtime is client-side per-widget; no shared server state. Per-instance nonces prevent cross-widget message bleed when many frames coexist.
- **Accuracy & auditability** — N/A here; the program source is already durably persisted in the message blocks (and #270 makes the pipeline durable).
- **Failure modes** — fail-closed by construction: program error/timeout → in-widget error card, sibling blocks unaffected (`VegaErrorBoundary` precedent, plus the watchdog). A CSP/sandbox regression fails toward *blocked rendering*, never toward exposure. Lean: error card includes the frame's reported message but never re-executes automatically.
- **Scale & unbounded growth** — many mounted frames × inline D3 is the pressure point; bounded-live-frames is explicitly #271's deliverable. Lean here: cheap teardown/re-init via the static-srcdoc + postMessage design so #271 can mount/unmount freely. Row volume is bounded by the handle service's own caps (100k retained, sampled above 50k) and delivered progressively in batch-grained pages with rAF-coalesced repaints, so neither the fetch nor the paint is a single unbounded unit of work.
- **Multi-tenancy** — the frame receives only the rows the org-scoped snapshot endpoint returned; opaque origin + no-egress CSP means a malicious program can't exfiltrate them or reach another org's data. This *is* the tenancy story for client-side execution.
- **Contract stability** — the bridge protocol carries `v: 1`; the program signature is a single options object (additive evolution); `D3BlockContentSchema` composes the envelope schema shared with every other large-result consumer. Future dashboard embedding (next epic) reuses the same module unchanged.
- **Data lifecycle** — N/A; this child introduces no storage. Handle TTL behavior is inherited and #270's problem.

## What this doesn't decide

- The `visualize_d3` tool, block minting, or agent prompt guidance — #269 (the program-signature contract defined here is its input).
- Durable pipeline persistence / refresh — #270 (the bridge's `data` message is designed for it).
- Widget chrome, lazy mounting, live-frame bounds — #271.
- Vega removal (#272) and pin gating (#273) — this child changes no existing renderer and adds nothing to `PortalResultTypeSchema`.

## Next step

`docs/D3_SANDBOX_RUNTIME.spec.md` (the bridge protocol, program signature, `D3BlockContentSchema`, and containment acceptance criteria as testable contract) then `.plan.md`. Expected slicing: core contract + barrel export → srcdoc/bootstrap + bridge utils (pure, heavily unit-tested) → `D3WidgetUI` + container + registration → `PortalMessage`/`QueryResultDataBlock` routing for handle-carrying blocks → stories + containment smoke checklist.
