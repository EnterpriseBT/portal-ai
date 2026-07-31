# In-flight tool activity indicator — Spec

**Issue:** [EnterpriseBT/portal-ai#279](https://github.com/EnterpriseBT/portal-ai/issues/279) · **Discovery:** `docs/TOOL_ACTIVITY_INDICATOR.discovery.md`

Pins the contract for surfacing which tool is running during a portal turn: two new **additive** SSE events (`tool_call` / `tool_call_end`) on the portal stream, a per-tool phase-label registry in `@portalai/core` with a name-derived fallback for custom tools, in-flight step tracking in `usePortalStream`, and two consuming surfaces — the existing inline `TypingIndicator` slot and a new **overlay** pill above the composer. The activity trail is ephemeral: nothing is persisted and nothing is rehydrated.

## Key decisions (flag for review)

1. **D1 — the phase label is its own registry**, `packages/core/src/registries/tool-phase-labels.ts`, **not** a field on `ToolCapability`. A capability field could never serve a custom tool (custom tools pass `capability = undefined`, `tools.service.ts:726-727`), so a resolver function is required regardless; `ToolCapabilitySchema`'s `superRefine` coherence rules stay untouched.
2. **D2 — the client resolves the label.** The wire carries `toolName`; `toolPhaseLabel(toolName)` runs in `apps/web`. Mirrors the existing `tool_result` → `streamingBlockFor` split, and keeps display copy out of the OpenAPI contract.
3. **D3 — `tool_call_end` is a third event; `ToolResultEventSchema` is not touched.** The contract change is **purely additive** (two new union variants). Step *lifecycle* and *renderable payload* stay separate concerns, and no existing consumer or `portal.service.test.ts` event-filter assertion moves.
4. **D4 — `toolSteps: ToolStep[]`** on `PortalStreamState`. The active step is the **last** element (most-recently-started wins); closing it falls back to the next still-open step rather than blanking.
5. **D5 — the strip is an overlay, and this is a hard requirement.** It is absolutely positioned inside the scroll container (`ChatWindow.component.tsx:181`) at its bottom edge — the same coordinate space as the existing jump buttons (`:193`/`:213`) — **not** a row in the composer's `flexShrink: 0` box (`:234`). No layout shift, no scroll re-measure, no input moving under a typing user. Recorded as an acceptance criterion on the issue.
6. **Q1 — the strip renders only while a step is open.** A tool-free text reply gets no pill (occlusion without information).
7. **Q2 — an errored tool emits no `tool-result` chunk**, so its step stays open until the terminal clear. Accepted: no per-step failure event.
8. **Q3 — accessibility:** the phase label is announced, the ticking counter is `aria-hidden` so a per-second re-render never reaches the live region.
9. **Q4 — all 33 built-in + system tools get curated copy**, enforced by a key-set pin against `ALL_TOOL_CAPABILITIES`. (Discovery said "30 + 2"; the verified registry count is **33** — see the pin in `tool-capabilities.test.ts:88-134`.)
10. **Q5 — an escalated `sql_query` closes its step when the tool returns.** The `bulk-job-progress` block owns the job's own progress; the step measures the tool call only.
11. **Custom tools derive from `name`, never `description`.** `name` is bounded by `TOOLPACK_SLUG_REGEX` (`organization-toolpack.model.ts:74-87`); `description` is unbounded free prose and is server-mutated with a cost note (`tools.service.ts:667-670`).
12. **Doc-sync:** the router's `@openapi` block is wrong on **three** counts today and all three are fixed here — the declared path (`/api/portals/…` vs. the real `/api/sse/portals/…`, mounted at `sse.router.ts:17` under `app.ts:55`), the `tool_result` field name (`name` vs. the wire's `toolName`), and the omission of `stream_error`.

## Scope

### In scope

1. `ToolCallEventSchema` + `ToolCallEndEventSchema` in `portal.contract.ts`, added to `PortalSSEEventSchema`.
2. `tool-phase-labels.ts` registry — `TOOL_PHASE_LABELS`, `toolPhaseLabel()`, `deriveToolPhaseLabel()` — exported via `@portalai/core/registries`.
3. Server emit from `handleToolCall` + `handleToolResult` in `portal.service.ts`.
4. Swagger registration of all **six** portal-stream events + a `PortalStreamEvent` `oneOf`, and the three `@openapi` corrections in `portal-events.router.ts`.
5. `toolSteps` tracking in `usePortalStream` + clearing on all four terminal paths.
6. `use-elapsed.util.ts` — the app's first ticking clock.
7. `TypingIndicator` extended with `label` / `elapsedSeconds`; `showTypingIndicator` widened.
8. New `ToolActivityStrip.component.tsx` + a `statusStrip` slot on `ChatWindowUIProps`.
9. `PortalSession` container wiring: derive the active step, run the clock once, pass to both surfaces.

### Out of scope

- Persisting the trail; message-block or rehydration changes.
- Author-supplied phase labels on the custom-toolpack registration contract.
- Rendering more than one concurrent step.
- Sub-tool internals (codegen attempt counts, row counts, percentages).
- Unifying with `bulk-job-progress` streaming.
- Cancel-button behavior beyond clearing the surfaces.
- Refactoring `PortalSession.component.tsx`'s pre-existing four-component-per-file violation.

## Surface

### 1. `packages/core/src/contracts/portal.contract.ts` (edit, after `DeltaEventSchema` at `:262`)

```ts
export const ToolCallEventSchema = z.object({
  type: z.literal("tool_call"),
  toolCallId: z.string(),
  toolName: z.string(),
});
export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;

export const ToolCallEndEventSchema = z.object({
  type: z.literal("tool_call_end"),
  toolCallId: z.string(),
  toolName: z.string(),
});
export type ToolCallEndEvent = z.infer<typeof ToolCallEndEventSchema>;
```

`PortalSSEEventSchema` (`:292`) gains both variants. `ToolResultEventSchema` (`:269-273`) is **unchanged**.

### 2. `packages/core/src/registries/tool-phase-labels.ts` (new)

```ts
/** Present-tense, user-facing phase for each built-in + system tool. */
export const TOOL_PHASE_LABELS: Record<string, string>;

/** Fallback for a custom/webhook tool (no capability row, no label):
 *  snake_case name → "Running <words>". Reads `name` only — never the
 *  org-authored `description`. Truncated to MAX_DERIVED_LABEL_LEN chars. */
export function deriveToolPhaseLabel(toolName: string): string;

/** Curated label when the tool is built-in, derived label otherwise.
 *  Never throws, never returns an empty string. */
export function toolPhaseLabel(toolName: string): string;

export const MAX_DERIVED_LABEL_LEN = 48;
```

`deriveToolPhaseLabel` normalizes `_`/`-` runs to single spaces, trims, lowercases, and returns `Running ${words}`; an empty or whitespace-only input returns `"Running a tool"`. Truncation appends `…`.

The 33 curated labels:

| Tool | Label | Tool | Label |
|---|---|---|---|
| `current_time` | Checking the time | `depreciation` | Calculating depreciation |
| `station_context` | Reading station context | `amortize` | Building the schedule |
| `sql_query` | Querying your data | `var_cvar` | Calculating risk |
| `display_entity_records` | Fetching records | `portfolio_metrics` | Analyzing the portfolio |
| `resolve_identity` | Matching records | `bond_math` | Running bond math |
| `visualize_d3` | Building the chart | `technical_indicator` | Computing indicators |
| `cluster` | Clustering records | `web_search` | Searching the web |
| `hypothesis_test` | Running the test | `entity_record_create` | Creating records |
| `regression` | Fitting the model | `entity_record_update` | Updating records |
| `logistic_regression` | Fitting the model | `entity_record_delete` | Deleting records |
| `forecast` | Forecasting | `connector_entity_create` | Creating the entity |
| `tvm` | Calculating time value | `connector_entity_update` | Updating the entity |
| `npv` | Calculating NPV | `connector_entity_delete` | Deleting the entity |
| `xnpv` | Calculating NPV | `field_mapping_create` | Creating the field mapping |
| `irr` | Calculating IRR | `field_mapping_update` | Updating the field mapping |
| `xirr` | Calculating IRR | `field_mapping_delete` | Deleting the field mapping |
| `transform_entity_records` | Transforming records | | |

Exported from `packages/core/src/registries/index.ts` (edit) alongside the existing three re-exports.

### 3. `apps/api/src/services/portal.service.ts` (edit)

`handleToolCall` (`:98`) — after the text flush and the `assistantBlocks.push`, emit:

```ts
if (typeof chunk.toolCallId === "string" && chunk.toolCallId.length > 0) {
  const event: ToolCallEvent = {
    type: "tool_call",
    toolCallId: chunk.toolCallId,
    toolName: chunk.toolName,
  };
  ctx.sse.send("tool_call", event);
}
```

`handleToolResult` (`:119`) — emit **unconditionally**, before and independent of the `resolveDisplayBlock` branch, under the same non-empty-`toolCallId` guard:

```ts
ctx.sse.send("tool_call_end", { type: "tool_call_end", toolCallId, toolName });
```

A missing/empty `toolCallId` cannot be paired by the client, so the event is skipped rather than sent with a sentinel. The existing `tool_result` emit (`:132-141`) and the `assistantBlocks` bookkeeping are untouched.

### 4. `apps/api/src/config/swagger.config.ts` (edit)

Register seven components, Zod-sourced with the existing `JSON_SCHEMA_OPTS` (`:69` — `unrepresentable: "any"`, which is what lets `ToolResultEvent.result`'s `z.unknown()` emit `{}`):

| Component | Source |
|---|---|
| `PortalDeltaEvent` | `z.toJSONSchema(DeltaEventSchema, JSON_SCHEMA_OPTS)` |
| `PortalToolCallEvent` | `ToolCallEventSchema` |
| `PortalToolCallEndEvent` | `ToolCallEndEventSchema` |
| `PortalToolResultEvent` | `ToolResultEventSchema` |
| `PortalDoneEvent` | `DoneEventSchema` |
| `PortalStreamErrorEvent` | `StreamErrorEventSchema` |
| `PortalStreamEvent` | `{ oneOf: [$ref × 6] }` — the `QueryHandleStreamEvent` pattern (`:1497-1518`) |

### 5. `apps/api/src/routes/portal-events.router.ts` (edit, `@openapi` block `:23-71`)

Three corrections plus the new events:

- **Path:** `/api/portals/{portalId}/stream` → `/api/sse/portals/{portalId}/stream` (real mount: `app.ts:55` + `sse.router.ts:17`).
- **`description`:** enumerate all six events — `delta`, `tool_call`, `tool_call_end`, `tool_result`, `done`, `stream_error` — with one clause each.
- **200 response:** replace the inline `schema: { type: string }` + stale prose (`:52-58`, which spells `tool_result`'s field as `name` and omits `stream_error`) with `$ref: '#/components/schemas/PortalStreamEvent'`.

### 6. `apps/web/src/utils/portal-stream.util.ts` (edit)

```ts
export interface ToolStep {
  toolCallId: string;
  toolName: string;
  /** Epoch ms, captured in the `tool_call` listener (event handler, not render). */
  startedAt: number;
}

export interface PortalStreamState {
  streamingBlocks: PortalMessageBlock[] | null;
  isStreaming: boolean;
  streamError: string | null;
  localMessages: PortalMessageResponse[];
  /** Open tool calls, oldest first. The active step is the last element. */
  toolSteps: ToolStep[];
}
```

Two new listeners registered in `send()` alongside the existing four:

```ts
es.addEventListener("tool_call", (e: MessageEvent) => {
  const data = JSON.parse(e.data) as ToolCallEvent;
  setToolSteps((prev) => [
    ...prev.filter((s) => s.toolCallId !== data.toolCallId),
    { toolCallId: data.toolCallId, toolName: data.toolName, startedAt: Date.now() },
  ]);
});

es.addEventListener("tool_call_end", (e: MessageEvent) => {
  const data = JSON.parse(e.data) as ToolCallEndEvent;
  setToolSteps((prev) => prev.filter((s) => s.toolCallId !== data.toolCallId));
});
```

The `tool_call` filter-then-append makes a duplicate id idempotent and keeps "newest is last" true. `setToolSteps([])` is added to **all four** terminal paths — `cancel` (`:91`), `done` (`:163`), `stream_error` (`:189`), `es.onerror` (`:199`) — and `send()` initializes it to `[]` alongside `setStreamingBlocks([])` (`:125`). No ref mirror is needed: no handler reads the array.

### 7. `apps/web/src/utils/use-elapsed.util.ts` (new)

```ts
/** Whole seconds since `startedAt`, re-rendering once a second. Returns 0 and
 *  registers no interval when `startedAt` is null. */
export function useElapsed(startedAt: number | null): number;
```

`Date.now()` is read inside the effect/interval callback, never in render body — the same rule `streamStartedAt` follows (`PortalSession.component.tsx:377`). The interval is cleared on unmount and whenever `startedAt` changes.

### 8. `apps/web/src/components/TypingIndicator.component.tsx` (edit)

```ts
interface TypingIndicatorUIProps {
  ariaLabel?: string;
  /** Active phase, e.g. "Building the chart". Dots-only when absent. */
  label?: string;
  /** Whole seconds on the active step; rendered as "18s" beside the label. */
  elapsedSeconds?: number;
}
```

With no props the render is byte-identical to today (dots, `role="status"`, `data-testid="typing-indicator"`). With `label`, the dots are followed by the label `Typography` (`variant="body2"`, `color="text.secondary"`) and, when `elapsedSeconds` is a number, an `aria-hidden` counter span (`data-testid="typing-indicator-elapsed"`). `aria-label` becomes the label when provided so the announcement is the phase, not "Assistant is typing"; the counter is excluded from the live region (Q3).

### 9. `apps/web/src/components/ToolActivityStrip.component.tsx` (new, pure UI only)

```ts
export interface ToolActivityStripUIProps {
  label: string;
  elapsedSeconds: number;
}
export const ToolActivityStrip: React.FC<ToolActivityStripUIProps>;
```

A partial-width `Paper` pill — `elevation={2}`, `bgcolor: "background.paper"`, `borderRadius`, `display: "inline-flex"`, a small `CircularProgress size={14}`, the label, and the `aria-hidden` counter. `role="status"` with `aria-label={label}`, `data-testid="tool-activity-strip"`. It carries **no positioning of its own** — placement belongs to the slot (below).

### 10. `apps/web/src/components/ChatWindow.component.tsx` (edit)

```ts
export interface ChatWindowUIProps {
  // …existing…
  /** Rendered as an overlay pinned to the bottom of the scroll region,
   *  directly above the composer border. Occupies no layout space. */
  statusStrip?: React.ReactNode;
}
```

Rendered **inside** the `position: relative` scroll container (`:181`), as a sibling of the two jump buttons, immediately after the `showJumpBottom` block:

```tsx
{statusStrip && (
  <Box sx={{ position: "absolute", bottom: 8, left: 16, right: 64, zIndex: 1,
             display: "flex", justifyContent: "flex-start", pointerEvents: "none" }}>
    {statusStrip}
  </Box>
)}
```

`right: 64` keeps clear of the jump-to-bottom button; `pointerEvents: "none"` keeps the overlay from stealing clicks or text selection from the feed beneath it. The composer box (`:234`) is **not** modified.

### 11. `apps/web/src/components/PortalSession.component.tsx` (edit)

- `PortalSessionUIProps` and `MessageListProps` gain `activeToolLabel?: string | null` and `activeToolElapsedSeconds?: number`.
- `MessageList`: `showTypingIndicator` (`:64`) becomes `isStreaming && (!hasStreamingContent || activeToolLabel != null)`; the render at `:107` passes `label`/`elapsedSeconds` through.
- `PortalSessionUI` passes `statusStrip={activeToolLabel ? <ToolActivityStrip … /> : undefined}` to `ChatWindowUI`.
- Container: `const activeStep = streamState.toolSteps[streamState.toolSteps.length - 1] ?? null;` (**not** `.at(-1)` — `apps/web` targets ES2020, where `Array.prototype.at` is not in `lib`) then `const elapsedSeconds = useElapsed(activeStep?.startedAt ?? null);` and `const activeToolLabel = activeStep ? toolPhaseLabel(activeStep.toolName) : null;`. The clock runs **once**, in the container; both surfaces receive numbers and strings only.

## Migration / Seed

**None.** No Drizzle table, column, or enum changes; no `ApiCode` additions; nothing seeded. Nothing is persisted by this feature, so there is no backfill and no rehydration path.

## TDD test plan

All suites run via the package's npm script — `npm run test:unit` from `packages/core`, `apps/api`, `apps/web` (never `jest`/`npx` directly: the scripts set `NODE_OPTIONS=--experimental-vm-modules`, without which the ESM suites fail to load).

### `packages/core` — `npm run test:unit`

`src/__tests__/contracts/portal.contract.test.ts` (edit — the SSE union has no coverage today): `ToolCallEventSchema` parses a valid payload and rejects a missing `toolCallId`; same for `ToolCallEndEventSchema`; `PortalSSEEventSchema` discriminates all six `type`s; an unknown `type` fails; `ToolResultEventSchema` still parses its current shape unchanged (the no-regression pin for D3). **≈ 7 cases.**

`src/__tests__/registries/tool-phase-labels.test.ts` (new): pin `Object.keys(TOOL_PHASE_LABELS).sort()` equal to `Object.keys(ALL_TOOL_CAPABILITIES).sort()` (mirrors `tool-capabilities.test.ts:134`, so adding a tool forces a label); every label is non-empty, trimmed, and starts uppercase; `toolPhaseLabel("sql_query")` is the curated string; `toolPhaseLabel("refresh_crm")` is `"Running refresh crm"`; hyphens and repeated underscores collapse; an over-long name truncates to `MAX_DERIVED_LABEL_LEN`; empty/whitespace input returns `"Running a tool"`. **≈ 9 cases.**

### `apps/api` — `npm run test:unit`

`src/__tests__/services/portal.service.test.ts` (edit — extends `describe("streamResponse")` at `:824`, reusing the `makeSse()` mock at `:285` and the existing `sse.send` call-filter style): `tool_call` is sent with the chunk's `toolCallId` + `toolName`; it is **not** sent when `toolCallId` is missing; `tool_call_end` is sent for a display-producing tool; `tool_call_end` **is sent for a non-display tool** whose `resolveDisplayBlock` returns `null` (the regression the ticket names — a stats-only turn); `tool_call_end` precedes `tool_result` for the same call; `tool_result`'s payload is unchanged for a display tool. **≈ 6 cases.**

`src/__tests__/config/swagger.config.test.ts` (edit): the six event components + `PortalStreamEvent` are registered under `components.schemas`; `PortalStreamEvent.oneOf` holds exactly six `$ref`s; `paths["/api/sse/portals/{portalId}/stream"]` is defined and the old `/api/portals/{portalId}/stream` key is **not** (the suite already asserts against `swaggerSpec.paths` at `:157-166`, and `swaggerSpec` is built from the route JSDoc via `apis: ["./src/routes/*.ts"]`, `:1684`); the 200 response's `text/event-stream` schema is the `PortalStreamEvent` `$ref`. **≈ 5 cases.**

### `apps/web` — `npm run test:unit`

`src/__tests__/portal-stream-tool-steps.test.ts` (new — needs a **capturable** fake `EventSource`; today's `portal-stream.util.test.ts` covers only the pure `streamingBlockFor`, and `PortalSession.test.tsx:80-89` stubs `addEventListener` as a no-op): a `tool_call` opens a step with `toolName` + a numeric `startedAt`; a second `tool_call` makes the newer step last; `tool_call_end` on the newer id falls back to the older step (the D4 rule); `tool_call_end` on an unknown id is a no-op; a duplicate `tool_call` id does not duplicate the entry; `done`, `stream_error`, `onerror`, and `cancel` each clear `toolSteps`; `send()` starts from `[]`. **≈ 10 cases.**

`src/__tests__/use-elapsed.util.test.ts` (new, `jest.useFakeTimers()`): returns 0 for `null`; registers no interval for `null`; advances to 1 then 2 after two seconds; resets when `startedAt` changes; clears the interval on unmount. **≈ 5 cases.**

`src/__tests__/TypingIndicator.test.tsx` (edit): with no props the dots and `data-testid` still render (backwards-compat); `label` renders as text; `elapsedSeconds` renders as `18s`; the counter carries `aria-hidden`; `aria-label` is the label when provided. **≈ 5 cases.**

`src/__tests__/ToolActivityStrip.test.tsx` (new): renders label + elapsed; counter is `aria-hidden`; `role="status"` with the label as `aria-label`. **≈ 3 cases.**

`src/__tests__/ChatWindowUI.test.tsx` (edit): `statusStrip` renders when provided and is absent otherwise; the rendered wrapper is absolutely positioned (asserting the overlay contract — no layout participation); the composer's `TextField` is still present and is **not** a sibling of the strip inside the composer box. **≈ 3 cases.**

`src/__tests__/PortalSession.test.tsx` (edit — upgrade the `sse.api` stub at `:80-89` to capture listeners): driving `tool_call` shows the phase label in both the inline indicator and the strip; a subsequent `tool_call_end` + `done` clears both; `stream_error` clears both and leaves the error `StatusMessage`; Cancel clears both; a tool-free turn renders no strip (Q1). **≈ 5 cases.**

**Totals ≈ 58 cases** across three packages (core 16, api 11, web 31). No migration test and no seed test — there is no schema change.

## Acceptance criteria

- [ ] Prompting a chart over a large table shows a continuously-updating indicator naming the phase and elapsed seconds, from send until the chart renders, with no gap after the assistant's opening text.
- [ ] Both surfaces show the phase: inline in the feed and in the overlay strip, and the strip stays visible when the feed is scrolled up.
- [ ] A multi-tool turn advances the label as each tool starts, leaving no stale label.
- [ ] With two calls open at once, the newest is shown; closing it reveals the older one rather than blanking.
- [ ] A custom/webhook tool shows a name-derived label for its duration — never blank.
- [ ] A turn whose tools produce no display block still shows the indicator and clears it on completion.
- [ ] Cancel mid-tool clears both surfaces immediately.
- [ ] On `stream_error`, both clear and the error `StatusMessage` remains.
- [ ] **Neither surface causes layout shift**: the composer never moves, the feed's scroll position is not re-measured mid-turn, and typing during a tool call is uninterrupted.
- [ ] After the turn, no trace of the trail remains — the rendered blocks are the record.
- [ ] Reloading mid-turn shows no phantom indicator.
- [ ] `/api-docs` lists all six portal-stream events under the correct `/api/sse/portals/{portalId}/stream` path.

## Risks & rollback

- **Wire-format risk: none by construction.** Both events are new union variants; `EventSource` dispatches only to registered listeners, so an old client ignores them and a new client against an old server simply never opens a step. `tool_result` is byte-identical, so no existing consumer changes.
- **Fail-open, cosmetically.** Every failure mode degrades to today's behavior: a dropped `tool_call` means no indicator; a dropped `tool_call_end` (or an errored tool, Q2) means a label that lingers to the end of the turn. `done`/`stream_error`/`onerror`/`cancel` are four independent backstops, so no state can outlive a turn — and nothing is persisted, so a reload is a guaranteed reset. There is no cost or safety consequence to either direction.
- **Overlay occlusion** is the one real UX cost: the pill covers the bottom-left of the feed while a tool runs. Mitigated by partial width, `pointerEvents: "none"`, and unmounting the moment the last step closes. If it proves obtrusive, the pill's width/side is a one-line change.
- **Timer churn.** One 1s interval exists only while a step is open. If the label + counter re-render proves expensive inside a long feed, the counter can move to its own leaf component without touching the contract.
- **Rollback** is per-slice and independent: reverting the `apps/web` slices leaves two harmless unconsumed events on the wire; reverting the server slice leaves a client that opens no steps. Neither half is load-bearing for the other.

## Files touched

**New**
- `packages/core/src/registries/tool-phase-labels.ts`
- `packages/core/src/__tests__/registries/tool-phase-labels.test.ts`
- `apps/web/src/utils/use-elapsed.util.ts`
- `apps/web/src/__tests__/use-elapsed.util.test.ts`
- `apps/web/src/components/ToolActivityStrip.component.tsx`
- `apps/web/src/__tests__/ToolActivityStrip.test.tsx`
- `apps/web/src/__tests__/portal-stream-tool-steps.test.ts`

**Edit**
- `packages/core/src/contracts/portal.contract.ts`, `packages/core/src/registries/index.ts`
- `packages/core/src/__tests__/contracts/portal.contract.test.ts`
- `apps/api/src/services/portal.service.ts`, `apps/api/src/config/swagger.config.ts`, `apps/api/src/routes/portal-events.router.ts`
- `apps/api/src/__tests__/services/portal.service.test.ts`, `apps/api/src/__tests__/config/swagger.config.test.ts`
- `apps/web/src/utils/portal-stream.util.ts`
- `apps/web/src/components/PortalSession.component.tsx`, `ChatWindow.component.tsx`, `TypingIndicator.component.tsx`
- `apps/web/src/__tests__/PortalSession.test.tsx`, `TypingIndicator.test.tsx`, `ChatWindowUI.test.tsx`

**Doc-sync check (per `CLAUDE.md` → "Keeping Documentation in Sync"):** no tool capability, input, or semantics changed, so the three tool surfaces (`*.tool.ts` descriptions, the `builtin-toolpacks.ts` mirror, `system.prompt.ts`) are untouched — the new registry is display-only metadata the agent never sees. `glossary.util.ts` / `faq.util.ts` are evaluated in the final slice: the feature introduces no new user-facing domain concept (it makes an existing one visible), so the expected outcome is no change, recorded rather than assumed.

## Next step

`docs/TOOL_ACTIVITY_INDICATOR.plan.md` slices this into ordered, independently-testable commits on this same branch — roughly five: (1) core contract + label registry with its pins; (2) server emit; (3) Swagger registration + the three `@openapi` corrections; (4) hook step tracking behind the new capturable `EventSource` fake; (5) the two surfaces, the elapsed hook, and the container wiring. Slices 1–4 are invisible to the user; slice 5 is what the smoke walk exercises.
