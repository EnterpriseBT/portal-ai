# D3 widget overflow & sizing — Discovery

**Issue:** [EnterpriseBT/portal-ai#278](https://github.com/EnterpriseBT/portal-ai/issues/278)

**Why this exists.** A `d3` widget clips its own content in both axes, with no scrollbar in either direction. On label-heavy forms (a Sankey's node labels, a beeswarm's category labels) the clipped material is *unreachable* — the marks are painted but hidden inside an opaque-origin iframe with no zoom, no scroll, and no "open larger". A chart whose legend is cut off is not merely ugly; a viewer can see marks whose meaning is hidden, which makes it actively misleading. This lands squarely against epic #267's framing: a widget that crops its own legend can't be a dashboard tile.

The clipping is not one bug but **three independent mechanisms in the widget host** — none of them in the agent-authored programs. The frame never learns a width other than its mount-time guess; the outer horizontal scroller can never engage because the iframe is always exactly as wide as its container; and the height report measures the DOM box rather than the painted extent, so marks drawn outside a declared SVG viewport are invisible *and* unaccounted for. This is the work that makes a widget's rendered extent — not its container's guess — the thing that determines its size.

## The current shape

### The size handshake, end to end

| Step | Location | Behavior |
|---|---|---|
| Init size captured once | `apps/web/src/modules/D3Widget/D3SandboxFrame.component.tsx:60-64` | `width: iframe.parentElement?.clientWidth \|\| FALLBACK_FRAME_WIDTH`, `height: INITIAL_FRAME_HEIGHT` |
| The constants | `apps/web/src/modules/D3Widget/D3SandboxFrame.component.tsx:11-12` | `INITIAL_FRAME_HEIGHT = 360`, `FALLBACK_FRAME_WIDTH = 640` |
| Program receives them | `apps/web/src/modules/D3Widget/utils/sandbox-bootstrap.js:55-68` | `api.width` / `api.height` from the stored init values |
| Frame reports back | `sandbox-bootstrap.js:69` | `post("rendered", { height: root.scrollHeight, rowCount })` |
| Continuous height | `sandbox-bootstrap.js:118-124` | in-frame `ResizeObserver` on `#root` → `resize { height: root.scrollHeight }` |
| Parent applies height | `D3SandboxFrame.component.tsx:67-73` | `setFrameHeight(event.height \|\| INITIAL_FRAME_HEIGHT)` on both `rendered` and `resize` |
| Iframe style | `D3SandboxFrame.component.tsx:112-120` | `sandbox="allow-scripts"`, `width: "100%"`, `height: frameHeight`, `border: 0`, `display: block` |
| Wrapper | `apps/web/src/modules/D3Widget/D3Widget.component.tsx:31-34`, `:198` | `CHART_BOUNDS = { width: "100%", maxWidth: "100%", overflowX: "auto" }` |
| In-frame CSS | `apps/web/src/modules/D3Widget/utils/sandbox-srcdoc.util.ts` (`buildSandboxSrcdoc`) | `html,body{margin:0;padding:0}#root{width:100%}` |

**The three mechanisms, confirmed by reading:**

1. **`overflowX: "auto"` can never engage.** The wrapper scrolls only if its child exceeds it, but the iframe is `width: "100%"` of that same wrapper. Overflow therefore happens *inside* the frame, where `#root{width:100%}` plus the SVG element's default `overflow:hidden` clips it silently. `CHART_BOUNDS` is dead code for horizontal purposes today.
2. **`api.width` is frozen at mount.** `bridge.sendResize` exists (`utils/bridge.util.ts:88`, `:188`) and the in-frame handler for a `resize` message exists (`sandbox-bootstrap.js:111-115`) — but **nothing in production calls `sendResize`.** Verified: the only reference outside `bridge.util.ts` is a jest mock (`__tests__/D3SandboxFrame.test.tsx:16`). There is no parent-side `ResizeObserver` anywhere in the module — the only one is the in-frame one at `sandbox-bootstrap.js:118`. A frame that mounts before layout settles, or in a column narrower than 640px, renders at a width its container doesn't have, and a later chat-column resize never reaches the program.
3. **`scrollHeight` measures the DOM box, not the painted extent.** A program that sets `svg height=360` from `api.height` and then draws below that line — a force simulation settling past its nominal band, a bottom axis, a legend — reports 360 while the excess is clipped by the SVG's own `overflow:hidden`. Nothing in the chain can detect it, which is exactly why the beeswarm loses a bottom sliver while the frame believes itself correctly sized.

### The bridge protocol (the contract this must evolve)

| Piece | Location | Note |
|---|---|---|
| Version | `utils/bridge.util.ts:15` | `BRIDGE_PROTOCOL_VERSION = 1 as const`; mirrored as `var VERSION = 1` at `sandbox-bootstrap.js:23` |
| Out-messages | `utils/bridge.util.ts:35-64` | `ready` · `rendered { height, rowCount }` · `resize { height }` · `error { message, stack? }` |
| In-messages | `utils/bridge.util.ts` (`SandboxInMessageSchema`) | `init { nonce, program, params, theme, size }` · `data` · `theme` · `resize { size }` |
| Callbacks | `utils/bridge.util.ts:75-79` | `onRendered({ height, rowCount })`, `onResize({ height })`, `onError`; `sendResize` declared `:88`, implemented `:188` |
| Spec | `docs/D3_SANDBOX_RUNTIME.spec.md:140-160` | pins the protocol; `:16` states the version exists **"for future additive evolution"** |
| Program contract | `docs/D3_SANDBOX_RUNTIME.spec.md:11` | `api = { d3, container, data, params, theme, width, height }` |

Both sides of the bridge ship in the same bundle — there is no version skew to support. The spec's stated intent is *additive* evolution under `v: 1`.

### Codegen guidance (the contributing surface)

`apps/api/src/prompts/visualize-d3.prompt.ts` documents the runtime to the model: `:27-28` describes `api.width` as "the available width in px" and `api.height` as "a suggested height in px"; `:42` instructs "Size to `api.width` / `api.height` so re-renders stay bounded"; the worked example at `:48-62` hardcodes `height = 260` with `margin = { top: 12, right: 12, bottom: 28, left: 40 }` and says nothing about legend placement or measuring label extents. A 40px left margin cannot fit a long tick label, and "size to api.height" is precisely the instruction that produces a viewport the marks then escape.

### Adjacent behavior that constrains the fix

- **Lazy mount/teardown (#271).** `D3WidgetGate.component.tsx:11`, `:17-29`, `:68` swaps a height-preserving placeholder (`style={{ height }}`, seeded from `lastHeight`) when the widget is far offscreen. Whatever becomes the authoritative height must keep feeding that placeholder, or scroll position jumps on teardown.
- **Progressive re-render.** `sandbox-bootstrap.js:56-73` clears and redraws on every batch, coalesced through `requestAnimationFrame` (`:76-79`). Any new measurement runs per render pass, so it must be cheap and must not itself trigger an observer loop.
- **Opaque origin.** `sandbox="allow-scripts"` without `allow-same-origin` (`D3SandboxFrame.component.tsx:112`) means the parent **cannot** read `iframe.contentDocument`. Every measurement must originate inside the frame and travel over the bridge.

## The design space

### Decision 0 — Who owns the widget's box: the frame, or the host?

This decision comes from a constraint the ticket doesn't mention: **the same `d3` widget will later live in a custom dashboard as well as a portal session.** Resizing in both hosts is *responsive only* — no drag handles, no manually-set tile dimensions (design review found manual resize too clunky and a source of UI complications). So the two hosts differ in exactly one respect: **how much width is available.** Vertically they behave identically — the widget always fits its entire visualization, and never scrolls internally.

That splits the sizing contract cleanly in two:

- **Width is host-supplied.** The host knows its available width (chat column, dashboard tile, whatever a future layout gives) and hands it to the program. Horizontal scrolling engages only when the visualization is intrinsically wider than that.
- **Height is content-determined, universally.** Not a host policy — an invariant. The frame reports its painted extent and the widget is exactly that tall, unbounded, in every host.

**A. Host supplies available width; frame reports painted extent; height is always content.** One shared sizing rule; hosts differ only in the width they provide.
**B. Frame-owned box.** The frame sizes itself entirely to its content, including width, and the host accommodates.
**C. Host-declared box only.** No extent reporting; the host guesses. That's today's behavior and the bug.

| | A — host width + reported extent | B — frame owns box | C — host guesses (today) |
|---|---|---|---|
| Fixes this ticket | Yes | Yes | No |
| Program can lay out responsively | Yes — it's told the available width | **No** — it never learns the container | Only at mount, then stale |
| Where "fits vertically, never scrolls" lives | Shared invariant, both hosts | Baked into the frame | — |
| Serves a second host (dashboard) | Yes — pass a different width | Partly — no responsive layout | No |

**Lean: A.** B is tempting for its simplicity but throws away responsiveness: a program that never learns its available width can't lay out for a narrow column, which is the very thing `api.width` exists for. A keeps the frame's job small and honest — *render into the width I gave you, tell me what you painted* — and the second host is then a different number, not a different mechanism.

Note what this **removes** from the earlier framing of this ticket: because vertical fit is now invariant rather than per-host, there is no "fixed-height tile" case, no in-widget vertical scrollbar to design, and no host that clips. The only host-specific question left is available width.

### Decision 1 — How the parent learns the content's true width

**A. Report content width from inside the frame** (additive `width` on `rendered`/`resize`), and size the iframe to `max(contentWidth, containerWidth)` so `CHART_BOUNDS`'s `overflowX: "auto"` becomes a real scroller.
**B. Measure from the parent** via `iframe.contentDocument`.
**C. Give the program an imperative `api.resize(w, h)`** it calls when it knows it needs more room.

| | A — frame reports | B — parent measures | C — program declares |
|---|---|---|---|
| Possible at all? | Yes | **No** — opaque origin blocks `contentDocument` | Yes |
| Protocol change | Additive field (sanctioned by spec `:16`) | None | New in-frame API + message |
| Works for existing programs | Yes — host-side only | — | **No** — every program must opt in |
| Failure mode | Falls back to container width | — | Silent clipping whenever the program forgets |

**Lean: A.** B is not merely worse, it's impossible under the sandbox flags the epic deliberately chose. C pushes correctness onto agent-authored code, where "the model forgot" becomes a silent clip — the same class of bug as #281. A fixes every existing program with no codegen dependency.

### Decision 2 — How the frame measures the *painted* extent

**A. Union of `getBoundingClientRect()` across `#root`'s descendants**, relative to `#root`'s own box.
**B. `getBBox()` on each top-level SVG**, mapped through its viewport transform.
**C. Keep `scrollHeight`, but set `overflow: visible` on the SVG** so escaping marks are at least *visible*.

| | A — rect union | B — SVG getBBox | C — overflow visible |
|---|---|---|---|
| Catches marks outside the SVG viewport | Yes | Yes (in SVG user units) | Visible, but **not measured** |
| Handles non-SVG content (HTML legends, divs) | Yes | No — SVG only | Partly |
| Cost per render pass | One tree walk of top-level children | Per-SVG, cheap | Free |
| Correct height reported to the parent | Yes | Yes | **No** — still `scrollHeight` |

**Lean: A, with C as a companion.** A is the only option that measures HTML *and* SVG content and needs no assumption about how the program structured its output. C alone doesn't fix the report (the frame would still claim 360 and the parent would still size to it), but flipping the SVG to `overflow: visible` is what makes the escaping marks paint at all once the frame has grown — so the fix wants both, not either.

### Decision 3 — Keeping the program's box live for the life of the mount

**A. Parent-side `ResizeObserver` on the wrapper → `bridge.sendResize`** (the already-implemented, currently-unreachable path).
**B. Re-mount the frame on container resize** (new frame, fresh `init`).

| | A — sendResize | B — remount |
|---|---|---|
| Wiring needed | One observer; both ends exist | Key change on the frame |
| Cost per resize | One message + one render pass | Full teardown, new iframe, re-page all data |
| Interaction with #271's gate | None | Fights the gate's mount/teardown accounting |
| Under a window-resize drag | Viable with coalescing | **Catastrophic** — a new iframe per observer tick |

**Lean: A.** `sendResize` being dead code is the bug, not a missing design; B throws away progressively-delivered data, and under any continuous reflow it would rebuild the iframe and re-page every batch repeatedly.

Which raises the cost question A has to answer: responsive resize is still **bursty**, even without drag handles. A user dragging a browser window edge, opening a side panel, or rotating a tablet produces a run of `ResizeObserver` ticks, and each one would otherwise mean a message, a full redraw, and a re-measure. The in-frame side already helps — `scheduleRender` coalesces through `requestAnimationFrame` (`sandbox-bootstrap.js:76-79`), so N messages in one frame cost one repaint — but the *parent* side has no coalescing today. **Lean: rAF-coalesce `sendResize` on the parent** (at most one per animation frame, last value wins). A handful of lines, and it's what keeps a window-resize from becoming a re-render storm over a 10k-row chart.

### Decision 4 — What `api.width` / `api.height` *mean* to a program

Today `api.width` is "available width" and `api.height` "a suggested height", and the prompt tells programs to "size to `api.width` / `api.height` so re-renders stay bounded" (`:42`). Under Decision 0 the two axes stop being symmetric, and the wording should follow:

**A. Asymmetric, matching the contract.** `width` is *the available width* — lay out for it; exceed it only when the chart is intrinsically wider (long category axis, wide Sankey), and the host will scroll horizontally. `height` is *a suggested starting height you may exceed freely* — the host always grows to fit whatever you paint, so never compress, clip, or scroll internally to stay inside it.
**B. Symmetric "the box the host gives you"** — render to fit both; the host reconciles.
**C. Keep the current wording.**

| | A — asymmetric | B — symmetric box | C — today |
|---|---|---|---|
| Matches the actual invariants | Yes — width constrains, height doesn't | No — implies height constrains too | No |
| Tells the program when it may exceed | Per axis, explicitly | Vaguely, both axes | "stay bounded" — the opposite |
| Encourages compressing a chart to fit | No | Somewhat | **Yes** — the clipping we're fixing |

**Lean: A.** This is the third framing this decision has had, and dropping manual resize is what settles it: with vertical fit invariant, "you may exceed the height freely" is now unconditionally true in every host, so the earlier worry (misleading a program inside a deliberately-sized tile) no longer exists. The remaining asymmetry is real and worth stating plainly — width is a layout constraint the program should respect, height is not a budget at all. The current `:42` instruction to "stay bounded" is actively steering toward the bug.

There's a deeper question underneath: prose in a prompt is advisory, and an LLM can ignore "measure your label extents" the same way it ignored "no markdown fences" in #281. **Lean: pair the guidance with something the program can't misread** — the reported extent means a clipping program now *self-corrects* on the next render pass rather than depending on having gotten the margins right the first time. See open question 6.

### Decision 5 — Protocol versioning

**A. Additive fields under `v: 1`** — `rendered { height, rowCount, width? }`, `resize { height, width? }`, optional so an older payload still parses.
**B. Bump to `v: 2`.**

**Lean: A.** The spec explicitly reserves the version field "for future additive evolution" (`docs/D3_SANDBOX_RUNTIME.spec.md:16`), both ends ship together, and a bump would mean touching every `z.literal(BRIDGE_PROTOCOL_VERSION)` and its pinning tests for zero behavioral gain. The issue floated "a `v1` → `v2` bump… or an additive field"; additive is the cheaper half of its own suggestion.

## Tradeoff comparison

|  | D0: host width + reported extent | D1: frame reports width | D2: rect union + `overflow:visible` | D3: `ResizeObserver` → coalesced `sendResize` | D4: asymmetric axis semantics | D5: additive under `v:1` |
|---|---|---|---|---|---|---|
| Spread to spec | Yes — the sizing contract | Yes — protocol + frame sizing | Yes — measurement rule | Yes — mount lifecycle | Yes — prompt + program contract | Yes — versioning note |
| Touches `apps/api` | No | No | No | No | **Yes** (`visualize-d3.prompt.ts`) | No |
| Changes agent programs | No | No | No | No | Guidance only | No |
| Risk of observer loop | Removes the ambiguity that causes it | Low | **Watch** — growth must not re-trigger measurement | **Watch** — parent↔frame ping-pong | None | None |
| Serves the future dashboard host | **The whole point** — pass a different width | Yes | Yes | Yes — responsive reflow drives it | Yes | Yes |

## Recommendation

0. **The host supplies the available width; the frame reports what it painted; height is always the painted extent.** Resizing is responsive only — there are no manual handles in any host. A second host (the future custom dashboard) differs solely in the width it provides, so it needs no change to the sandbox, the protocol, or the vertical rule.
1. Report the rendered **content width** alongside height on both `rendered` and `resize`, as optional additive fields under protocol `v: 1` — no version bump.
2. Measure the painted extent inside the frame as the **union of `getBoundingClientRect()` across `#root`'s descendants** (relative to `#root`), replacing bare `root.scrollHeight` for both width and height.
3. Set `overflow: visible` on rendered SVG content in the sandbox CSS so marks outside a declared viewport actually paint once the frame grows to fit them.
4. Size the iframe to `max(contentWidth, containerWidth)` so the existing `CHART_BOUNDS` `overflowX: "auto"` wrapper becomes a working horizontal scroller.
5. **The widget always fits its visualization vertically and never scrolls vertically — an invariant, in every host.** Frame height tracks the painted extent, unbounded; no `maxHeight` and no `overflowY` other than `visible` anywhere in the chain. (Confirmed clean today: the module's only overflow rule is `overflowX: "auto"` at `D3Widget.component.tsx:34`, so this is a constraint to preserve, not one to retrofit.) Because it's invariant rather than per-host, express it once as a shared sizing rule both hosts use — not duplicated policy, and not buried in the bootstrap where a host couldn't see it.
6. Add a parent-side `ResizeObserver` on the `CHART_BOUNDS` wrapper that drives the already-implemented `bridge.sendResize`, so the program's available width tracks the container for the life of the mount. Measure the **wrapper**, never the iframe, so frame growth cannot feed back into a width change.
7. **rAF-coalesce the outgoing `sendResize`** (at most one per animation frame, last value wins) — responsive reflow is bursty (window-edge drag, panel open, device rotation) even without manual handles.
8. Keep feeding #271's `D3WidgetGate` placeholder from the new authoritative height so offscreen teardown preserves scroll position.
9. In `visualize-d3.prompt.ts`, make the two axes asymmetric: `api.width` is the available width to lay out for (exceed only when the chart is intrinsically wider — the host scrolls horizontally); `api.height` is a suggested starting height the program may exceed freely, never compressing or clipping to stay inside it. Replace the `:42` "size to api.width / api.height so re-renders stay bounded" instruction and rework the worked example's margins (`:48-62`) so they stop modelling label-clipping geometry.

## Open questions

1. **Should the horizontal scroller live on the wrapper or inside the frame?** Wrapper-side (recommendation 4) keeps one scrollbar for the whole widget and lets the header stay put; frame-side would need the in-frame CSS to scroll `#root`, putting a scrollbar inside the sandbox where it can't be styled to match. **Lean: wrapper-side.**
2. **Does a width report risk an observer feedback loop?** Frame grows → iframe widens → wrapper's `ResizeObserver` fires → `sendResize` → program re-renders wider → repeat. **Lean: measure the wrapper's `clientWidth` (which the iframe cannot influence, since the iframe is inside it and the wrapper is `width:100%` of the chat column) and ignore iframe-driven size changes entirely.** A regression test should assert a stable fixed point after one growth cycle.
3. **What is `api.width` when the content is intrinsically wider than the container?** If the frame is sized to `max(content, container)` but `api.width` keeps reporting *container* width, a re-render recomputes the same wide layout and stays stable. If it reported the grown width, each pass could grow again. **Lean: `api.width` is always the host's available width (the chat column, or a dashboard tile's width later) — never the grown frame width; the frame's outer width is a presentation detail the program never sees.** This is the invariant that makes open question 2's fixed point hold.
4. **Do existing charts get wider, or just uncropped?** Recommendation 3 (`overflow: visible`) means previously-hidden marks now paint, which can change how existing charts look — arguably a fix, but visible churn. **Lean: accept it; a mark that was drawn was meant to be seen.** Worth an explicit smoke step comparing a few chart forms before/after.
5. **Should there be *any* ceiling on height?** A pathological program (one mark per row over 100k rows) could produce a multi-thousand-pixel frame. **Lean: no ceiling anywhere — not in either host, not in the frame, not in the protocol.** The ticket forbids one, "always fits the entire visualization" is now invariant, `HANDLE_ROW_CAP` bounds rows upstream, and #271's gate bounds how many frames are live. A very tall widget is a legible chart in a long page; a clipped one is a wrong chart. Revisit only with a real repro.

6. **Does a clipping program self-correct across render passes?** Once the frame reports its painted extent and the host grows to it, the *next* `resize` hands the program a wider/taller box — so a program whose margins were too tight gets a second chance without the model having to have been right the first time. That's a mechanism rather than prose guidance, which is the preference the house rule states (make the output unambiguous rather than trusting the prompt). **Lean: rely on it, and assert it in a test** — one growth cycle, then a stable fixed point (open question 2's test covers both). It does *not* remove the need for recommendation 9; a program that centres a legend outside the plot area still needs to know that's allowed.

7. **Where does horizontal scrolling live when the host is a dashboard tile rather than the chat column?** In the chat column the wrapper scrolls (open question 1). A tile is narrower, so wide charts will scroll more often there — but the mechanism is identical, since the tile is just a smaller available width. **Lean: nothing to decide now; the wrapper-side scroller works for any host that gives the widget a width.** Recorded so the dashboards epic doesn't re-litigate it.

## Enterprise-scale considerations

- **Concurrency & correctness** — `N/A because` this is per-mount client-side layout; no shared state, no check-then-act, no server writes. The one ordering concern is intra-component (measure → report → resize), addressed by open question 2's fixed-point requirement.
- **Accuracy & auditability** — `N/A because` nothing here is a record of truth; the widget renders from a block whose durable pipeline (#270) is unchanged.
- **Failure modes** — **Lean: fail-open, degrading to today's behavior.** If the measurement throws or reports 0, fall back to `scrollHeight` and then `INITIAL_FRAME_HEIGHT` (the existing `|| INITIAL_FRAME_HEIGHT` guard at `D3SandboxFrame.component.tsx:69`); if `ResizeObserver` is unavailable, keep the mount-time width (the module already fails open on a missing `ResizeObserver` at `sandbox-bootstrap.js:118`, and `useInView` set the same precedent in #271). A sizing bug must never blank a chart that would otherwise render.
- **Scale & unbounded growth** — **Lean: bound the work per render, not the output size.** The rect union walks `#root`'s subtree on every coalesced render pass; it must be O(top-level children) rather than a deep full-tree walk on a 10k-mark SVG, or a large chart pays a measurement tax per batch. Frame *height* stays deliberately unbounded (open question 5). The sharper case is the **resize burst**: dragging a window edge or opening a side panel produces a run of observer ticks, each of which would otherwise mean a message, a full redraw, and a re-measure — hence rAF-coalescing on both sides (recommendation 7) rather than treating resize as a rare event.
- **Multi-tenancy** — `N/A because` rendering is per-user, per-session, client-side; no cross-tenant surface and no shared server resource.
- **Contract stability** — **This is the dimension that shaped the design, via Decision 0.** The same widget will later run in a custom dashboard, where resizing is likewise responsive-only; the two hosts differ solely in available width. **Lean: (a) additive-only fields under `v: 1`, so the protocol stays forward-compatible; (b) the frame renders into a host-supplied width and reports its painted extent, with "fits vertically, never scrolls" expressed as one shared invariant rather than duplicated per-host policy or logic buried in the bootstrap; (c) `sendResize` — the path this ticket finally makes live — is the same path any responsive reflow will drive, so it is built coalesced from the start.** The alternative (hardcode the chat column's assumptions into the frame) would fix this ticket and then have to be unpicked, which is precisely the "shape the input so future features plug in without re-plumbing call sites" failure the lens exists to catch. Concretely, the dashboard host should need to supply a width and nothing else.
- **Data lifecycle** — `N/A because` no persisted data, window, or retention semantics are touched.

## What this doesn't decide

- **Interaction inside the widget** (zoom, pan, tooltips, brushing) — the sandbox spec deferred cross-boundary interaction messages (`docs/D3_SANDBOX_RUNTIME.spec.md:16`) and this ticket adds no `interaction` message. Scrolling is layout, not interaction.
- **An "open larger" / full-screen affordance.** It would sidestep cropping for wide charts, but it's a new surface with its own design (modal? route? print?) and the ticket's requirement is that the inline widget be correct on its own.
- **Row-count truncation (#277)** and **in-flight tool activity (#279)** — separate tickets found in the same sessions; neither is a sizing concern.
- **Rewriting the codegen prompt's chart-form guidance beyond sizing.** Recommendation 9 touches the width/height semantics and the example's margins. A broader "teach the model good chart design" pass is its own ticket.
- **A ceiling on widget height**, per open question 5.
- **The dashboard host itself** — tile layout, reordering, and persistence belong to the dashboards epic. This ticket only makes sure the sizing contract can serve that host: available width in, painted extent out, vertical fit invariant. It builds no tile and no persistence, and it assumes no manual resize affordance in either host.

## Next step

`docs/D3_WIDGET_OVERFLOW.spec.md` pins the contract: the additive `width` fields on `rendered`/`resize` under `v: 1`, the painted-extent measurement rule, the `max(contentWidth, containerWidth)` frame sizing, the no-vertical-scroll / unbounded-height invariant, and the revised `api.width`/`api.height` semantics documented to the agent — plus the updates those imply to `docs/D3_SANDBOX_RUNTIME.spec.md`'s protocol section, since that doc describes shipped behavior. `docs/D3_WIDGET_OVERFLOW.plan.md` then slices it, roughly: (1) in-frame painted-extent measurement + `overflow: visible`, reporting width additively, with bootstrap/bridge tests; (2) parent-side frame sizing — height to the painted extent, width to `max(content, container)` so the wrapper scrolls — as one shared sizing rule; (3) the `ResizeObserver` → rAF-coalesced `sendResize` wiring, with the fixed-point and coalescing regression tests; (4) the `visualize-d3.prompt.ts` axis semantics + worked-example margins, with its pinning test. Each slice is independently testable, and slice 1 is inert until slice 2 consumes the reported width.

The spec should state the sizing contract in host-agnostic terms — **available width in, painted extent out, vertical fit invariant** — since the custom dashboard is its second consumer and that framing is the whole reason Decision 0 exists. A concrete acceptance bar for that: standing up a second host should require supplying a width and nothing more.
