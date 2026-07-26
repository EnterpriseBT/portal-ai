# Visualization widget chrome + session render-load management — Discovery

**Issue:** [EnterpriseBT/portal-ai#271](https://github.com/EnterpriseBT/portal-ai/issues/271) (epic #267; blocked-by #269 + #270, both merged into `epic/d3-dashboard-widgets`)

**Why this exists.** Two presentation problems remain now that `d3` widgets exist. (1) A visualization still *looks* like a chat block — the epic's reframing needs a consistent widget **frame** carrying identity (title), data/render **status** (loading / rendering / error / stale-expired), and the #270 refresh affordance inline. (2) A long portal session mounts **every** chart as a live renderer, and each live `d3` widget inlines the *entire* minified D3 bundle into its own sandboxed iframe `srcdoc` — so unbounded mounting is heavier than the old Vega path. This child adds the widget frame and **session render-load management**: visualization widgets lazy-mount when scrolled near the viewport and tear their iframe down when far offscreen, so the count of live iframes stays bounded regardless of session length. This is the "presentation + lifecycle" half of the epic.

## The current shape

### Block routing & where chrome/gating attaches

| Piece | Location | Note |
|---|---|---|
| Block map (persisted) | `components/PortalMessage.component.tsx:191` | maps `message.blocks`; per-block `<Box key={i}>` at `:209` — the one place persisted assistant blocks are keyed + laid out |
| Web-block shortcut | `PortalMessage.component.tsx:115` `shouldRenderViaWeb` / `:42` `renderWebBlock` | `d3` is **not** a web block → flows to `ContentBlockRenderer` |
| Displayable gate | `:103` `isDisplayableBlock` (`hasBlockRenderer && hasRenderableContent`) | |
| d3 dispatch | `<ContentBlockRenderer>` `:229-233` | passes `blockRef={{messageId, blockIndex:i}}` + `dataUpdatedAt={message.created}` (#270) |
| Streaming map | `components/PortalSession.component.tsx:82-105` (`MessageList`) | streaming blocks render via the same path at `:92-96` but with **no** `blockRef`/`dataUpdatedAt` |

### The D3 widget module (already container + pure-UI split)

`modules/D3Widget/D3Widget.component.tsx:206` is the container (parses content, `useWidgetRefresh`, `useProgressiveHandleRows`, resolves handle vs inline); `D3WidgetUI` (`:64`) is the pure renderer. Chrome that **already exists**: header (`:85-127`) with title (`:91`), "Updated ⟨time⟩ ago" (`:98-106`), the #270 refresh `IconButton` (`:107-125`); body states loading (`:151` `d3-widget-loading`), error (`:140` `d3-widget-error`), progress caption (`:175`), `notRefreshable` note (`:129`). The outer element is a **bare `<Box data-testid="d3-widget">`** (`:184`) — no framed container. The iframe renders via `<D3SandboxFrameUI>` (`:167`) only in the non-loading/non-error branch.

### The sandbox iframe lifecycle + cost

`modules/D3Widget/D3SandboxFrame.component.tsx:109` renders one `sandbox="allow-scripts"` iframe with `srcDoc={SANDBOX_SRCDOC}`; the bridge is created per-mount in a `useEffect` (`:51-88`) and disposed in cleanup (`:82-85`, `bridge.dispose()`). The program is fixed per mount — a program change is a full remount (`:25-31`). **Cost:** `sandbox-srcdoc.util.ts:1` inlines `d3/dist/d3.min.js?raw` as an inline `<script>` (`:42`) — every live widget parses/executes a full D3 copy in its frame and compiles the program via `new Function` (`sandbox-bootstrap.js:95`). Tearing down far-offscreen frames reclaims that per-frame D3 runtime + DOM — the whole point of render-load management. The iframe self-reports height (`INITIAL_FRAME_HEIGHT = 360`, `D3SandboxFrame.component.tsx:11`).

### Streaming / in-progress

`utils/portal-stream.util.ts:38` `streamingBlockFor` maps a `tool_result` to `{type:"d3", content}` (`:45`) with **no** `blockRef`; on `done` (`:163`) blocks finalize into a `localMessages` assistant message (`created: Date.now()`). A streaming `d3` widget is therefore non-refreshable (`use-widget-refresh.util.ts` returns no-op without `blockRef`) and sits auto-scrolled at the bottom (always in view).

### Scroll container & viewport prior art

**No** existing `IntersectionObserver` / `useInView` / virtualization hook — net-new. The single scroll container is `ChatWindow.component.tsx`'s `scrollRef` (`overflow:auto` Box, `:172-178`), used with `ResizeObserver` for stick-to-bottom (`:80-89`); it is private to `ChatWindowUI`, exposed only via the imperative `ChatWindowHandle` (`:31-35`). Layout is a plain vertical map — no virtualization; every message + iframe mounts today.

### Module conventions

Component File Policy (`CLAUDE.md:102`) + Module Pattern (`:270`): container + pure `*UI` in one file, co-located `__tests__/` + `stories/` + barrel `index.ts`. `modules/D3Widget/` conforms; `stories/D3Widget.stories.tsx:97-145` renders `D3WidgetUI` with fixture states (Loading, ProgressiveRendering, ErrorCard, WithTitle, DarkTheme, ThrowingProgram). Registration: `utils/register.util.tsx:11`.

## The design space

### Decision 1 — Lazy-mount / teardown mechanism

| | A — `IntersectionObserver` hook | B — scroll-position math | C — virtualization lib (react-window/virtuoso) |
|---|---|---|---|
| Scope fit | wraps only viz widgets (PRD: don't virtualize other blocks) | same | virtualizes the whole list (over-scope) |
| Complexity | small net-new hook | brittle manual math | heavy dep, list-level rewrite |
| Teardown control | precise (margins) | manual | list-managed, not per-widget |

**Lean: A** — a small `useInView` hook over `IntersectionObserver`. Only visualization widgets manage their lifecycle (text/data-table/mutation untouched, per the PRD out-of-scope). A **mount margin** (rootMargin ~1 viewport ahead) plus a larger **teardown margin** (hysteresis, ~2 viewports) keeps the live-iframe count bounded and prevents mount/unmount thrash at the boundary. "Bounded count" is emergent from the margins — no hard LRU cap needed.

### Decision 2 — Observer root plumbing

The observer needs the scroll container as `root`, but it's private to `ChatWindowUI`.

| | A — extend `ChatWindowHandle` | B — `root: null` (viewport) | C — `ScrollRootContext` |
|---|---|---|---|
| Reaches deep widgets | via prop-drill | no plumbing | via context, no drill |
| Correct root | yes | only if the Box fills the viewport (it doesn't always) | yes |
| Test/Storybook | needs handle mock | trivial | falls back to `null` when unprovided |

**Lean: C** — a `ScrollRootContext` provided by `ChatWindowUI` exposing the scroll-container element; the widget's `useInView` consumes it, falling back to the viewport (`root: null`) when absent (Storybook, tests). No prop-drilling through the message/block tree.

### Decision 3 — Where chrome + the mount gate live

The persistent **chrome** (frame, title, status, refresh) should stay visible even when the iframe is torn down; only the heavy **body** (data paging + iframe) mounts/unmounts.

**Lean: split at the body.** The always-mounted container (`D3Widget`) keeps the cheap state — `useWidgetRefresh` (refresh control, `lastUpdatedAt`, auto-refresh, fresh delivery) + `useInView` — and renders the framed chrome (`D3WidgetUI`, extended with a `Paper`/bordered frame + explicit stale/expired status). The **body** — `useProgressiveHandleRows` + `<D3SandboxFrameUI>` — moves into an in-view-only child (`D3WidgetBody`) that mounts when `inView` and unmounts (disposing the bridge) when offscreen; offscreen renders a **height-preserving placeholder** (last-known frame height, fallback `INITIAL_FRAME_HEIGHT`). The D3 **module owns the lifecycle** (via the registered renderer), so it works wherever a `d3` block renders — persisted *and* streaming.

### Decision 4 — Streaming widget handling

A streaming `d3` widget has no `blockRef` (non-refreshable) and is auto-scrolled at the bottom (in view). **Lean:** the lazy-mount applies uniformly — a streaming widget is in-view so stays live; its non-refreshable/no-stale state is already handled by #270. No special-casing beyond "chrome shows title + in-progress status, no refresh control when `blockRef` is absent."

## Tradeoff comparison

|  | D1: `useInView` hook | D2: `ScrollRootContext` | D3: body-split + placeholder | D4: streaming uniform |
|---|---|---|---|---|
| Spread to spec | Yes (hook + margins) | Yes (context + ChatWindow provider) | Yes (component decomposition + placeholder height) | Yes (chrome-without-refresh rule) |

## Recommendation

1. Add a net-new `useInView` hook (`IntersectionObserver`) that reports near-viewport membership using a mount margin + a larger teardown margin (hysteresis).
2. Provide the scroll container via a `ScrollRootContext` from `ChatWindowUI`; `useInView` consumes it, falling back to the viewport when unprovided.
3. Frame the widget: extend `D3WidgetUI` with a bordered frame, title, and explicit status (loading / rendering / error / stale-expired), keeping the #270 refresh control + "Updated ⟨time⟩ ago".
4. Split the heavy body (data paging + sandbox iframe) into an in-view-only child that mounts near-viewport and tears down (disposing the bridge) far offscreen; render a height-preserving placeholder when torn down; re-mount + re-render from block content on scroll-back.
5. Keep refresh/auto-refresh state in the always-mounted container so the chrome stays interactive independent of the body's mount state.
6. Streaming widgets render the frame + in-progress status with no refresh control (no `blockRef`); they stay live because they're in view.

## Open questions

1. **Scroll-root access.** `ScrollRootContext` (lean) vs. extend `ChatWindowHandle`. **Lean: context** — no prop-drilling, clean Storybook/test fallback.
2. **Gate the data fetch too, or just the iframe?** The PRD says re-mount re-renders "from its block content," implying re-fetch on scroll-back. **Lean: gate both** — move `useProgressiveHandleRows` into the in-view child so an offscreen widget holds neither the iframe nor an open paging loop; re-page on re-mount (cheap; #270's freshness gate avoids needless server refresh).
3. **Mount/teardown margins.** Exact `rootMargin` values. **Lean: mount ~1 viewport ahead, teardown ~2** (hysteresis band prevents boundary thrash); spec pins the numbers, tunable.
4. **Placeholder initial height.** Before a widget has ever rendered, there's no measured height. **Lean: `INITIAL_FRAME_HEIGHT` (360)** as the seed; replace with the last measured frame height once rendered.
5. **Does the chrome show status for a torn-down widget?** **Lean: yes** — frame + title + "Updated ⟨time⟩ ago" persist (cheap, from container state); the body area shows the placeholder. Status like "rendering N of M" only appears while the body is mounted.

## Enterprise-scale considerations

- **Scale & unbounded growth.** *This is the ticket.* Each live widget = a full inlined D3 runtime in an iframe; a long session unbounded-mounts them. The `IntersectionObserver` margins bound the live count to ~what's near the viewport, independent of session length. **Lean: margin-bounded live set; verify the bridge is disposed on teardown so nothing leaks.**
- **Failure modes.** Teardown must `bridge.dispose()` (no leaked `postMessage` listeners / detached iframes); a widget that errors still shows the frame + error status; a missing measured height falls back to the seed so scroll never collapses. **Lean: fail-safe — always render the frame + a sized placeholder, never a zero-height gap.**
- **Contract stability.** The frame + lazy-mount are shaped for reuse by the **dashboards epic** (pinned widgets on a grid need the same chrome + bounded rendering). **Lean: keep the frame + `useInView` general (not chat-specific) so a dashboard grid reuses them.**
- **Concurrency & correctness / Multi-tenancy / Accuracy & auditability / Data lifecycle** — **N/A because** this is client-side presentation/lifecycle only; no server state, no per-tenant data, no billing. Refresh cost is already free/rate-limited (#270).

## What this doesn't decide

- **Pinning affordance changes** (#273) and **dashboards** (next epic) — out of scope; this only frames + lifecycles the in-session widget.
- **Virtualizing non-visualization blocks** (text / data-table / mutation) — explicitly out of scope; only `d3` widgets manage their mount lifecycle.
- **Server/refresh behavior** — unchanged from #270; this ticket only changes *when* a widget mounts and *how* it's framed.

## Next step

Write `docs/VIZ_WIDGET_CHROME.spec.md` (contract: the `useInView` hook signature + margins, the `ScrollRootContext` shape + `ChatWindow` provider, the `D3WidgetUI` frame/status prop additions, the `D3Widget`/`D3WidgetBody` decomposition + placeholder, and the Storybook/test surface) and `.plan.md`. The plan will likely slice as: (1) `useInView` hook + `ScrollRootContext` + `ChatWindow` provider; (2) `D3WidgetUI` frame + status states + stories; (3) the body-split lazy-mount/teardown + height-preserving placeholder; each green-testable on `feat/viz-widget-chrome`, PRing into `epic/d3-dashboard-widgets`.
