# Sandboxed D3 render runtime + `d3` block renderer — Spec

**Issue:** [EnterpriseBT/portal-ai#268](https://github.com/EnterpriseBT/portal-ai/issues/268) · **Epic:** #267 · **Discovery:** `docs/D3_SANDBOX_RUNTIME.discovery.md`

Pins the contract for executing agent-authored D3 render programs in a fully sandboxed iframe: the `d3` block content schema in core, the sandbox document + CSP, the postMessage bridge protocol (batched/progressive by design), the program signature, the web module that hosts it all, and its registration into the open block-renderer registry.

## Key decisions (flag for review)

1. **Containment = `srcdoc` iframe, `sandbox="allow-scripts"` (nothing else) + in-document CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'`.** Opaque origin (no cookies/storage/app-origin), no network egress of any kind. (Discovery D1, resolved.)
2. **Full `d3` v7 bundle, pinned exact, inlined into the srcdoc via Vite `?raw`.** No CDN, no served asset, CSP stays `'none'`. (D2 + Q1.)
3. **Program contract: function-body source, `new Function("api", program)` in the frame; `api = { d3, container, data, params, theme, width, height }`.** (D3.)
4. **Progressive rendering is bootstrap-owned**: batches accumulate frame-side; the pure program is re-invoked with the full accumulated array, rAF-coalesced, container cleared per invoke. The agent never sees a streaming API. (D6 + PRD amendment.)
5. **Row ceiling is the handle service's** (100k cap / 50k sampling) — the client pages `getSnapshot` at the 1000-row batch grain until exhausted. (Q6.)
6. **Refinement over discovery:** no `PortalMessage.component.tsx` edit. The registered `d3` renderer is web-side and its container handles *both* inline and handle-carrying content, so `shouldRenderViaWeb`/`renderWebBlock` stay untouched. Bonus (verified): `PINNABLE_BLOCK_TYPES` derives from `PortalResultTypeSchema`, which does not include `d3` — new widgets get **no pin affordance** automatically; #273 still owns gating the legacy vega types.
7. **Known limit (Q2, accepted):** the render watchdog bounds time-to-first-render only. A rendered-but-spinning program is not CPU-limited from the parent; #271's offscreen teardown bounds it.
8. **Cross-boundary interaction messages deferred** (Q4) — protocol carries `v: 1` for future additive evolution; no `interaction` message ships.

## Scope

### In scope

1. Core: `d3` block type + `D3BlockContentSchema` contract; `portal-sql.contract.js` added to the contracts barrel; envelope schema split for composability.
2. Web: `modules/D3Widget/` — sandbox srcdoc builder, bridge, progressive-rows hook, frame + widget components, registration, tests, stories.
3. Web: `sdk.portalSql.handleSnapshotPage` imperative paged read.
4. `d3` dependency (apps/web only, exact version).
5. Jest `?raw` module mapping in `apps/web/jest.config.js`.

### Out of scope

- The `visualize_d3` tool, block minting, prompt guidance (#269).
- Pipeline persistence / refresh endpoint (#270) — the bridge's `data` message is its seam.
- Widget chrome, lazy mount, live-frame bounds (#271).
- Vega removal (#272); pin gating for legacy vega types (#273).
- Any server/API/schema change — **no migration, no seed** (see below).

## Surface

### `packages/core/src/contracts/portal.contract.ts`

`PortalBlockTypeSchema` (`:162`) gains `"d3"` (with a doc-comment line: `d3 — sandboxed D3 render program (#268)`):

```ts
export const PortalBlockTypeSchema = z.enum([
  "text", "vega-lite", "vega", "data-table", "mutation-result",
  "tool-call", "tool-result", "d3",
]);
```

`PortalResultTypeSchema` (`models/portal-result.model.ts:14`) is **not** touched — `d3` is not pinnable.

### `packages/core/src/contracts/portal-sql.contract.ts`

Split the envelope so it can be composed (`.superRefine` makes the current export a `ZodEffects`, which can't `.extend`):

```ts
/** Bare field object — composable via .extend(). */
export const QueryHandleEnvelopeFieldsSchema = z.object({ /* the existing 8 fields, verbatim */ });
export const QueryHandleEnvelopeSchema = QueryHandleEnvelopeFieldsSchema.superRefine(/* existing sampled/sampleSize check, verbatim */);
```

`QueryHandleEnvelope` type unchanged. **Barrel fix:** `contracts/index.ts` adds `export * from "./portal-sql.contract.js"` (it is missing today — verified). The api-side re-declaration (`apps/api/src/services/portal-sql-handle.service.ts:30`) is left in place for #269/#270 to consolidate — this child changes nothing in `apps/api`.

### `packages/core/src/contracts/d3-widget.contract.ts` (new)

```ts
import { z } from "zod";
import { QueryHandleEnvelopeFieldsSchema } from "./portal-sql.contract.js";

export const D3ProgramParamsSchema = z.record(z.string(), z.unknown());

const D3BaseContentSchema = z.object({
  /** Function-body source. Executed in the sandbox as
   *  `new Function("api", program)` — see the runtime contract in
   *  apps/web/src/modules/D3Widget. Never evaluated in the app context. */
  program: z.string().min(1),
  title: z.string().optional(),
  params: D3ProgramParamsSchema.optional(),
});

/** Inline binding — rows baked into the block (≤ INLINE_ROWS_THRESHOLD). */
export const D3InlineContentSchema = D3BaseContentSchema.extend({
  rows: z.array(z.record(z.string(), z.unknown())),
});

/** Handle binding — the full query-handle envelope rides the content,
 *  matching the vega-lite handle-block shape (content.queryHandle sniffing). */
export const D3HandleContentSchema = D3BaseContentSchema.extend(
  QueryHandleEnvelopeFieldsSchema.shape
);

/** Handle branch first: content carrying queryHandle must match it. */
export const D3BlockContentSchema = z.union([D3HandleContentSchema, D3InlineContentSchema]);
export type D3InlineContent = z.infer<typeof D3InlineContentSchema>;
export type D3HandleContent = z.infer<typeof D3HandleContentSchema>;
export type D3BlockContent = z.infer<typeof D3BlockContentSchema>;
```

Exported from `contracts/index.ts`. The reserved `"d3"` `ResultKind` (`models/tool-capability.model.ts:78`) already exists — its comment updates from `// curated D3 renderer (child H)` to `// sandboxed D3 render program (#268)`.

### `apps/web/src/modules/D3Widget/` (new module, RegionEditor shape)

```
modules/D3Widget/
  index.ts                       # barrel: D3Widget, D3WidgetUI + props types, registerD3BlockRenderer, bridge/theme types
  D3Widget.component.tsx         # D3WidgetUI (pure) + D3Widget (container)
  D3SandboxFrame.component.tsx   # D3SandboxFrameUI (pure; owns the iframe element)
  utils/
    sandbox-srcdoc.util.ts       # buildSandboxSrcdoc() + SANDBOX_SRCDOC + SANDBOX_CSP
    sandbox-bootstrap.js          # in-frame bootstrap source (imported ?raw)
    bridge.util.ts               # message schemas + createSandboxBridge()
    progressive-rows.util.ts     # useProgressiveHandleRows()
    sandbox-theme.util.ts        # D3SandboxTheme + buildSandboxTheme(muiTheme)
    register.util.ts             # registerD3BlockRenderer()
  __tests__/                      # unit tests (see test plan)
  stories/D3Widget.stories.tsx    # web Storybook (:7007) — real-browser execution surface
```

#### `sandbox-srcdoc.util.ts`

```ts
export const SANDBOX_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'";

/** Pure — injectable sources so tests pass fixtures; prod passes ?raw imports. */
export function buildSandboxSrcdoc(parts: { d3Source: string; bootstrapSource: string }): string;

/** Module-level constant built once from the real ?raw imports:
 *  import d3Source from "d3/dist/d3.min.js?raw";
 *  import bootstrapSource from "./sandbox-bootstrap.js?raw"; */
export const SANDBOX_SRCDOC: string;
```

Document shape: `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"><style>…container reset…</style></head><body><div id="root"></div><script>${d3Source}</script><script>${bootstrapSource}</script></body></html>`.

#### `sandbox-bootstrap.js` (runs inside the frame)

Plain JS, no imports. Behavior contract:

1. On load: `parent.postMessage({ v: 1, nonce: null, type: "ready" }, "*")` — nonce is learned from `init`.
2. On `init { nonce, program, params, theme, size }`: store nonce (all later in/out messages must carry it), compile `new Function("api", program)` inside try/catch (compile error → `error` message), store api inputs.
3. On `data { rows, seq, done }`: append rows to the accumulator; schedule a render via `requestAnimationFrame` (multiple batches per frame coalesce into one invoke).
4. Render pass: clear `#root`, invoke the program with `api = { d3, container: root, data: accumulatedRows, params, theme, width, height }` in try/catch; success → `rendered { height, rowCount }`; throw → `error { message, stack }`.
5. On `theme` / `resize`: update stored values, schedule a render pass.
6. `ResizeObserver` on `#root` → `resize { height }` messages.
7. Message hygiene: ignore any message whose `nonce` doesn't match (post-init) or that fails shape checks. `postMessage` targets `"*"` (opaque origin has no addressable origin); authenticity is source+nonce, validated parent-side.

#### `bridge.util.ts`

```ts
export const BRIDGE_PROTOCOL_VERSION = 1;
export const RENDER_TIMEOUT_MS = 10_000;
export const D3_SNAPSHOT_PAGE_SIZE = 1_000; // mirrors the handle service's batch grain

// Zod schemas for every message (both directions), all { v: literal(1), nonce: string }-based:
export const SandboxInMessageSchema  = /* union: init | data | theme | resize */;
export const SandboxOutMessageSchema = /* union: ready | rendered | resize | error */;

export interface SandboxBridgeCallbacks {
  onRendered(e: { height: number; rowCount: number }): void;
  onResize(e: { height: number }): void;
  onError(e: { message: string; stack?: string }): void;
}

/** Wires a mounted iframe: window "message" listener filtered by
 *  event.source === iframe.contentWindow AND nonce match (OAuth-popup
 *  validation pattern); sends init on ready; exposes sendData/sendTheme/
 *  sendResize; arms the render watchdog from init until the first
 *  rendered/error (fires onError with a timeout message); dispose()
 *  removes the listener and cancels the watchdog. Nonce = crypto.randomUUID(). */
export function createSandboxBridge(
  iframe: HTMLIFrameElement,
  init: { program: string; params?: Record<string, unknown>; theme: D3SandboxTheme; size: { width: number; height: number } },
  callbacks: SandboxBridgeCallbacks
): { sendData(rows: Row[], seq: number, done: boolean): void; sendTheme(t: D3SandboxTheme): void; sendResize(s: Size): void; dispose(): void };
```

postMessage delivery is FIFO per source/target pair, so `init` → `data(seq 0…n)` ordering needs no acking.

#### `sandbox-theme.util.ts`

```ts
export interface D3SandboxTheme {
  mode: "light" | "dark";
  background: string;
  text: string;
  fontFamily: string;
  monospaceFontFamily: string;
  categorical: string[]; // [primary, secondary, success, warning, error, info].main
}
export function buildSandboxTheme(theme: MuiTheme): D3SandboxTheme;
```

#### `progressive-rows.util.ts`

```ts
export interface ProgressiveRowsState {
  batches: Array<{ rows: Row[]; seq: number; done: boolean }>; // emitted in order
  receivedRows: number;
  complete: boolean;
  error: string | null; // READ_HANDLE_EXPIRED mapped to the expired-cache copy
}
/** Pages sdk.portalSql.handleSnapshotPage from offset 0 by D3_SNAPSHOT_PAGE_SIZE
 *  until rows are exhausted (rows.length < limit or offset ≥ total). Emits each
 *  page as it lands (first paint after page one). Stops on unmount/error. */
export function useProgressiveHandleRows(queryHandle: string | null): ProgressiveRowsState;
```

#### `D3SandboxFrame.component.tsx` — `D3SandboxFrameUI` (pure, single-component file)

```ts
export interface D3SandboxFrameUIProps {
  program: string;
  params?: Record<string, unknown>;
  theme: D3SandboxTheme;
  batches: ProgressiveRowsState["batches"]; // inline binding = one batch { seq: 0, done: true }
  onRendered?: (e: { height: number; rowCount: number }) => void;
  onError: (e: { message: string }) => void;
}
```

Renders `<iframe sandbox="allow-scripts" srcDoc={SANDBOX_SRCDOC} title="D3 visualization" style={{ width: "100%", border: 0, height }} />`; owns the bridge lifecycle (create on mount, dispose on unmount, forward new batches/theme/size); tracks reported height. The `sandbox` attribute is exactly `allow-scripts` — asserted by test.

#### `D3Widget.component.tsx` — `D3WidgetUI` (pure) + `D3Widget` (container)

```ts
export interface D3WidgetUIProps {
  program: string;
  title?: string;
  params?: Record<string, unknown>;
  theme: D3SandboxTheme;
  batches: ProgressiveRowsState["batches"];
  totalRows: number;      // envelope rowCount, or inline rows.length
  truncated?: boolean;    // "N+" label rule, as QueryResultDataBlockUI
  receivedRows: number;
  complete: boolean;
  loading: boolean;       // no batch yet
  error: string | null;   // fetch error OR sandbox error/timeout
}
export interface D3WidgetProps { content: D3BlockContent; }
```

UI states: `error` → error card (`data-testid="d3-widget-error"`, monospace message, chart area replaced — mirrors `VegaErrorBoundary`'s presentation); `loading` → spinner + "Loading N rows…"; else → `D3SandboxFrameUI` + (while `!complete`) a caption "Rendering X of N rows…". Container: parses content with `D3BlockContentSchema`; inline → single done batch; handle → `useProgressiveHandleRows`; theme via MUI `useTheme` → `buildSandboxTheme`; sandbox `onError` → error state. Chart area is bounded by the existing `CHART_BOUNDS` convention (`width/maxWidth 100%`).

#### `register.util.ts`

```ts
/** Idempotent. Called once at web bootstrap. */
export function registerD3BlockRenderer(): void {
  registerBlockRenderer("d3", (block) => <D3Widget content={block.content as D3BlockContent} />);
}
```

**`apps/web/src/main.tsx`** — add `import { registerD3BlockRenderer } from "./modules/D3Widget"; registerD3BlockRenderer();` before `createRoot(...)`. No `PortalMessage.component.tsx` change (Key decision 6).

### `apps/web/src/api/portal-sql.api.ts`

Existing `handleSnapshot` (declarative `useAuthQuery`, `:26`) unchanged. Add the imperative paged read (per the SDK-helper rule: imperative GETs use `useAuthMutation`):

```ts
handleSnapshotPage: () =>
  useAuthMutation<HandleSnapshotPayload, { handleId: string; offset: number; limit: number }>({
    method: "GET",
    url: (v) => `/api/portal-sql/handle/${encodeURIComponent(v.handleId)}?offset=${v.offset}&limit=${v.limit}`,
    body: () => undefined,
  }),
```

No query-key addition (mutations aren't keyed); no cache invalidation (read-only).

### Dependencies & config

- `apps/web/package.json`: `d3` pinned **exact** (`"d3": "7.9.0"` — latest v7 at implementation time, no `^`). No `@types/d3` (parent code never calls d3; it only inlines the source text).
- `apps/web/jest.config.js`: `moduleNameMapper` entry `"\\?raw$": "<rootDir>/src/__tests__/raw-stub.js"` (stub exports an empty string). Real srcdoc composition is tested through `buildSandboxSrcdoc` with fixture sources (that's why it's injectable).
- `apps/web/vite.config.ts`: no change (`?raw` is built-in).

## Migration / Seed

None — no schema, no server change. Stated per template.

## TDD test plan

Run via npm scripts only: `cd packages/core && npm run test:unit`; `cd apps/web && npm run test:unit`. No migration/seed test (none exists to test).

### Layer 1 — core contracts (`packages/core/src/__tests__/contracts/d3-widget.contract.test.ts` + edits to existing portal contract tests)

1. `D3InlineContentSchema` parses `{ program, rows }`; rejects empty/missing `program`; accepts optional `title`/`params`.
2. `D3HandleContentSchema` parses `{ program }` + full envelope fields; rejects a missing envelope field (e.g. no `rowCount`).
3. `D3BlockContentSchema` union: handle-shaped content resolves the handle branch (envelope fields present post-parse); rows-shaped resolves inline.
4. `QueryHandleEnvelopeSchema` still enforces the `sampled ⇒ sampleSize` refinement after the fields split (regression).
5. `QueryHandleEnvelopeFieldsSchema` + `D3BlockContentSchema` are importable from `@portalai/core/contracts` (barrel).
6. `PortalBlockTypeSchema` includes `"d3"`; `PINNABLE_BLOCK_TYPES` does **not**.
7. `ContentBlockRenderer` renders a registered `d3` renderer's output for a `d3` block (registry round-trip, extends the existing registry test).

### Layer 2 — web module utils (`apps/web/src/modules/D3Widget/utils/__tests__/`)

8. `buildSandboxSrcdoc` output contains the exact `SANDBOX_CSP` meta, both injected sources in order, and matches `/^<!doctype html>/i`.
9. `buildSandboxSrcdoc` output contains no `http://`/`https://` substring (no external references).
10. `createSandboxBridge` sends `init` (with program/theme/size + fresh nonce) only after a `ready` message from the frame's `contentWindow` source.
11. Bridge ignores messages from a different source and messages with a wrong nonce (no callback fires).
12. `sendData` posts `data { rows, seq, done }` with the bridge nonce; ordering preserved across calls.
13. Watchdog: fake timers — no `rendered`/`error` within `RENDER_TIMEOUT_MS` of init → `onError` (timeout message); a `rendered` message cancels it.
14. `rendered`/`resize`/`error` messages invoke the matching callbacks with parsed payloads; malformed payloads are dropped.
15. `dispose()` removes the window listener and cancels the watchdog (no callbacks after).
16. `useProgressiveHandleRows`: pages of `D3_SNAPSHOT_PAGE_SIZE` requested from offset 0; each page emitted as an ordered batch; `complete` set when a short page arrives; `receivedRows` accurate.
17. `useProgressiveHandleRows`: `READ_HANDLE_EXPIRED` → the expired-cache error copy; other errors → message passthrough; no further paging after error/unmount.
18. `buildSandboxTheme` maps mode/background/text/fonts/6 categorical mains from a real brand theme object.
19. `sandbox-bootstrap.js` source contains the load-bearing markers: `new Function("api"`, `requestAnimationFrame`, `ResizeObserver`, and a `postMessage` (string-level assertions; execution is covered by Storybook/smoke per resolved Q5).

### Layer 3 — web components (`apps/web/src/modules/D3Widget/__tests__/`)

20. `D3SandboxFrameUI` renders an iframe whose `sandbox` attribute is exactly `allow-scripts` and whose `srcDoc` is `SANDBOX_SRCDOC`.
21. `D3WidgetUI` loading state (no batches); progress caption "X of N rows…" while `!complete` (with "N+" when `truncated`); caption gone when complete.
22. `D3WidgetUI` error state renders the error card testid + message and does not mount the frame.
23. `D3Widget` container with inline content produces one `done` batch and no SDK call (mocked SDK asserts zero invocations).
24. `D3Widget` container with handle content drives batches from the (mocked) paged SDK and forwards envelope `rowCount`/`truncated`.
25. `registerD3BlockRenderer()` → `hasBlockRenderer("d3")` true; idempotent on double call; renderer output is a `D3Widget` for a `d3` block.

**Totals ≈ 25 cases** (7 core + 12 utils + 6 components).

## Acceptance criteria

- [ ] A `d3` block with a valid program renders inside an iframe with `sandbox="allow-scripts"` (no `allow-same-origin`); in devtools, any `fetch`/XHR/WebSocket/img/script egress attempted by a test program is CSP-blocked (manual smoke).
- [ ] A program attempting `document.cookie`, `localStorage`, or `window.parent.document` gets an exception inside the frame; the app is unaffected (manual smoke).
- [ ] A handle-backed widget paints after its **first** 1000-row page and grows to the full retained row set with a visible progress caption; the session UI stays responsive throughout.
- [ ] A program that throws, fails to compile, or renders nothing within 10 s shows the in-widget error card; sibling blocks and the session view are unaffected.
- [ ] `hasBlockRenderer("d3")` is true in the running app; no existing renderer changed; text/vega/data-table blocks render exactly as before.
- [ ] `d3` blocks show no pin affordance (excluded from `PINNABLE_BLOCK_TYPES` by construction).
- [ ] Expired handle → the existing "expired from cache" message inside the widget (refresh affordance is #270).
- [ ] All new tests pass; `npm run lint && npm run type-check && npm run test` green at root.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| CSP/sandbox gap lets a program exfiltrate rows or touch app state. | Defense in depth: opaque origin (sandbox w/o `allow-same-origin`) **and** `default-src 'none'` CSP **and** no capability handed across the bridge beyond plain data. Acceptance includes manual egress probes; srcdoc test 9 forbids external references. Fail direction is *blocked rendering*, never exposure. |
| `?raw` import breaks jest resolution. | Explicit `moduleNameMapper` stub + injectable `buildSandboxSrcdoc` keeps all srcdoc tests on fixture strings. |
| jsdom can't execute the frame, so bootstrap behavior is under-tested. | Resolved Q5: bridge unit tests mock the boundary; Storybook (web :7007) is the real-browser surface; smoke walks the egress/error/progressive checks manually. |
| A spinning program pegs a CPU core after first render. | Accepted known limit (Key decision 7); #271 teardown bounds it. Documented in the module README/JSDoc. |
| Large srcdoc (~280KB) × many widgets pressures memory. | Single module-level `SANDBOX_SRCDOC` string constant; per-frame cost is the browser's document instance, bounded by #271. |
| Union schema misroutes content carrying both `rows` and `queryHandle`. | Handle branch ordered first + test 3; #269 (the only producer) never emits both. |
| postMessage race (`data` before `init`). | FIFO ordering per source/target pair is guaranteed by the platform; bridge additionally sends `init` before any `sendData` is accepted. |

**Rollback:** pure revert — no schema, no server surface, no persisted-data shape change. Removing the registration + module restores the exact prior behavior (`d3` blocks would render as nothing, as today).

## Files touched

**`packages/core`** — edit: `contracts/portal.contract.ts` (+`"d3"`), `contracts/portal-sql.contract.ts` (fields split), `contracts/index.ts` (+2 barrel lines), `models/tool-capability.model.ts` (comment only); new: `contracts/d3-widget.contract.ts`; tests: new `__tests__/contracts/d3-widget.contract.test.ts`, edits to portal-sql/portal contract + `ContentBlockRenderer` tests.

**`apps/web`** — new: `modules/D3Widget/` (barrel, 2 component files, 6 utils, tests, stories), `src/__tests__/raw-stub.js`; edit: `api/portal-sql.api.ts` (+`handleSnapshotPage`), `main.tsx` (registration), `jest.config.js` (`?raw` mapper), `package.json` (+`d3` exact).

**No changes** to `apps/api`, DB, infra, or env vars.

## Next step

`docs/D3_SANDBOX_RUNTIME.plan.md` — expected slices: (1) core contracts (`d3` block type, envelope split, `D3BlockContentSchema`, barrel) green in isolation; (2) sandbox srcdoc + bootstrap + bridge utils (pure, the bulk of the unit tests); (3) progressive-rows hook + SDK paged read; (4) frame + widget components + theme util; (5) registration + stories + smoke doc. Each slice a testable commit on this branch.
