# In-flight tool activity indicator — Discovery

**Issue:** [EnterpriseBT/portal-ai#279](https://github.com/EnterpriseBT/portal-ai/issues/279)

**Why this exists.** A portal turn that calls tools can run for tens of seconds — `sql_query` has a 30s synchronous ceiling before it escalates to the job tier, and `visualize_d3` stacks an Opus codegen sub-call with up to three attempts on top of the query. The feed shows nothing during that window. The typing indicator is scoped to the pre-first-token gap (`showTypingIndicator = isStreaming && !hasStreamingContent`, `apps/web/src/components/PortalSession.component.tsx:64`), which is correct for a text reply but wrong for a tool turn: the model emits a one-line preamble, the indicator unmounts, and the feed freezes until the finished block lands. *Working*, *stalled*, and *broken* are indistinguishable.

The frontend is not under-using available signal — the signal does not exist. `handleToolCall` (`apps/api/src/services/portal.service.ts:98`) flushes accumulated text and pushes a `tool-call` block for `ModelMessage[]` reconstruction, and sends **no SSE event**. The only tool-related event on the wire is `tool_result`, and only when `resolveDisplayBlock` returns a renderable block (`:132-141`), so a stats-only turn produces no tool event at all. This is the ticket that puts "which tool is running right now" on the wire and builds the two surfaces that consume it.

## The current shape

### The server stream loop

| Piece | Location | Note |
|---|---|---|
| `streamResponse` | `portal.service.ts:607` | Builds tools via `ToolService.buildAnalyticsTools`, `streamText` with `stopWhen: stepCountIs(10)` (`:633`) — so a turn is bounded at 10 steps. |
| Chunk dispatch | `portal.service.ts:650` | One `for await` over `result.fullStream`, switching on `chunk.type`: `text-delta`→`:90`, `tool-call`→`:98`, `tool-result`→`:119`, `error`→`sse.sendError` + return (`:657-668`), `finish`→text flush (`:669`). |
| `StreamContext` | `portal.service.ts:83` | `{ assistantBlocks, sse, currentText }` only — no timing, no in-flight bookkeeping. |
| `handleToolResult` | `portal.service.ts:119` | Persists the raw `tool-result` block, then emits `tool_result` **only if** `resolveDisplayBlock` (`:150`) returns a block. `resolveDisplayBlock` already reads `ALL_TOOL_CAPABILITIES[toolName]?.resultKind`. |
| Turn teardown | `portal.service.ts:698-734` | Orphaned `tool-call` blocks (no matching result) are stripped, the assistant message is persisted (`:715`), then `done` is sent (`:729-734`). |
| SSE helper | `apps/api/src/utils/sse.util.ts:33` | `send(event, data)`, `sendData` (`:39`), `sendError` (`:45` — emits `stream_error` then ends). |

Wire event names today: exactly `delta`, `tool_result`, `done`, `stream_error`. Payload schemas live in `packages/core/src/contracts/portal.contract.ts:260-299` (`DeltaEventSchema`, `ToolResultEventSchema` — `type`/`toolName`/`result`, **no `toolCallId`** — `DoneEventSchema`, `StreamErrorEventSchema`), unioned as `PortalSSEEventSchema` (`:292`).

### The contract's documentation state

The route is `portal-events.router.ts:72` with its `@openapi` block at `:23-71`. The 200 response declares `text/event-stream` with `schema: { type: string }` and a hand-written prose event list (`:53-58`) that is **already stale**: it spells `tool_result` as `{ type, name, result }` (the wire field is `toolName`) and omits `stream_error` entirely. None of the four portal-stream event payloads are registered in `apps/api/src/config/swagger.config.ts` — the copyable precedents are the hand-written `BulkJobTerminalEvent` (`:1460-1481`) and, for a multi-shape stream, the `oneOf` in `QueryHandleStreamEvent` (`:1497-1518`). Anything registered there must be mirrored in the round-trip test (`swagger.config.ts:19-27`, `apps/api/src/__tests__/config/swagger.config.test.ts:88`).

### The frontend hook

`apps/web/src/utils/portal-stream.util.ts` is plain `useState` — no reducer. State: `localMessages`, `streamingBlocks`, `isStreaming`, `streamError` (`:72-79`); refs `streamingBlocksRef` (stale-closure escape for `done`), `esRef`, `onDoneRef` (`:83-89`). It returns `[PortalStreamState, PortalStreamActions]` (`:16`, `:23`). `send()` (`:111`) opens the EventSource via `sse.create()` and registers listeners inline: `delta` (`:129`), `tool_result` (`:148`, mapped through the exported pure `streamingBlockFor` at `:38` and appended only when non-null), `done` (`:163`), `stream_error` (`:189`), `es.onerror` (`:199`). `cancel()` is `:91`; unmount cleanup `:212`. **Four terminal paths** must reset any new state: `done`, `stream_error`, `onerror`, `cancel`.

### The consuming view

`PortalSession.component.tsx` splits container (`:220`) / pure UI (`:175`) per the Component File Policy, but also defines `MessageList` (`:46`) and `PortalSessionEmptyState` (`:117`) in the same file — it predates the two-components-per-file rule, so anything new lands in its own file. `showTypingIndicator` is derived inside `MessageList` (`:64`) and rendered as a bare `<TypingIndicator />` (`:107`). `streamStartedAt` is captured in `handleSubmit` with `setStreamStartedAt(Date.now())` (`:377`), cleared in `handleStreamDone` (`:272`), and used only to stamp `<MessageTimestamp>` (`:102`) — the established `Date.now()`-in-an-event-handler pattern. Scroll is a one-shot initial effect (`:291-308`) plus an append-driven auto-scroll (`:325-343`).

The composer is in `ChatWindow.component.tsx:234` — a `flexShrink: 0` bordered box holding the `TextField` and the action `Stack`. **There is no pinned or sticky element above it today** (only absolutely-positioned jump buttons inside the scroll area, `:193`/`:213`), so a strip needs a new slot in `ChatWindowUIProps` (`:38`). `TypingIndicator.component.tsx` is a single pure component with one prop, `ariaLabel` (`:7`), rendering three dots in a `Paper` with `role="status"` and `data-testid="typing-indicator"`.

### Live-ticking precedent

There is **none**. No ticking clock and no shared interval hook exist in `apps/web`; the only `setInterval` is the version poller (`apps/web/src/utils/app-version.util.ts:39`). `DateFactory.relativeTime` (`packages/core/src/utils/date.factory.ts:152`) is minute-granular and consumed statically (`D3Widget.component.tsx:147`). `BulkJobProgressBlock.component.tsx` is a structural precedent only (container `useReducer` + effect-attached EventSource at `:266`, pure UI at `:106`) — its `batchDurationMsAvg` (`:70-79`) comes from SSE payloads, not a clock. The closest analogue to a per-tool label map is `apps/web/src/utils/running-job-label.util.ts` — a switch with a raw-string fallback.

### Tool metadata

`ToolCapability` is a Zod object with heavy `superRefine` coherence rules (`packages/core/src/models/tool-capability.model.ts:132-237`): `pure`, `reads`, `writes`, `consumption`, `computeShape`, `costHint`, `locks`, `resultKind`, `production`, `alwaysAvailable`. Per-tool metadata is authored twice in `packages/core/src/registries/builtin-toolpacks.ts` — the pack literals (`ToolpackToolSpec`, `:66-98`) and the `CAPABILITIES` matrix keyed by tool name (`:1053-1187`) — stitched by `attachCapabilities` (`:1191`), which **throws** for any tool missing a capability entry. `ALL_TOOL_CAPABILITIES` (`registries/tool-capabilities.ts:62`) aggregates `SYSTEM_TOOL_CAPABILITIES` (`:30`) with every built-in pack tool, keyed by name. The **33** names (count verified against the `costHint` pin's key set, `tool-capabilities.test.ts:88-134`): `current_time`, `station_context`, `sql_query`, `display_entity_records`, `resolve_identity`, `visualize_d3`, `cluster`, `hypothesis_test`, `regression`, `logistic_regression`, `forecast`, `tvm`, `npv`, `irr`, `xnpv`, `xirr`, `depreciation`, `amortize`, `var_cvar`, `portfolio_metrics`, `bond_math`, `technical_indicator`, `web_search`, and the nine `entity_management` writers plus `transform_entity_records`.

Pinning tests that constrain a new field: `packages/core/src/__tests__/registries/tool-capabilities.test.ts:87` — the `costHint` pin, whose `EXPECTED_COST_HINTS` map carries a **key-set equality assertion against `ALL_TOOL_CAPABILITIES` (`:134`)** — and `builtin-toolpacks.test.ts:14`/`:62`/`:95` (pack count, name uniqueness, every capability parses).

### Custom / webhook tools

`tools.service.ts:644-698` wraps each entitled custom pack tool as a `WebhookTool` (`:671-693`) after a built-in collision check (`:656`). The record shape is `ToolpackToolDefinitionSchema` (`packages/core/src/models/organization-toolpack.model.ts:74-87`): `name` constrained to `TOOLPACK_SLUG_REGEX` (snake_case, bounded), a required free-prose `description` (server-mutated with a cost note at `:667-670`), `parameterSchema`, optional `bulkDispatch`, optional `capability`. **There is no `displayName`/`label` field**, and custom tools are deliberately absent from `ALL_TOOL_CAPABILITIES` (`tools.service.ts:726-727` passes `capability = undefined`, with a no-warn carve-out at `:733`). The pack-level display precedent is `ToolPackUtil.getLabel` (`apps/web/src/utils/tool-packs.util.ts:22`) — label map with raw-string fallback.

## The design space

### Decision 1 — Where the per-tool phase label lives

**A. A field on `ToolCapability`.** Add `phaseLabel: string` to the Zod schema and to all 33 `CAPABILITIES` entries. The ticket named this as the natural home, alongside `costHint`/`resultKind`.

**B. A sibling registry + resolver.** New `packages/core/src/registries/tool-phase-labels.ts` exporting a `TOOL_PHASE_LABELS` map keyed by tool name plus `toolPhaseLabel(toolName): string` that falls back to a name-derived label. `ToolCapability` is untouched.

**C. Frontend-only map** in `apps/web/src/utils/tool-phase-label.util.ts`, mirroring `running-job-label.util.ts`.

| | A (capability field) | B (sibling registry) | C (web util) |
|---|---|---|---|
| Touches `ToolCapabilitySchema` + its `superRefine` | Yes | No | No |
| Serves custom tools (no capability row) | No — needs a separate fallback anyway | Yes — the resolver is the contract | Yes |
| Reusable server-side (label on the wire, prompts, logs) | Yes | Yes | No |
| Pin-test pattern available | Reuses the `costHint` key-set pin | Same pattern, own file | None |
| Ticket alignment | Named in the PRD | Adjacent to it | Contradicts "not hardcoded in the view" |

**Lean: B.** `ToolCapability` encodes *enforcement* semantics (purity, reads/writes, cost, locks) validated by interlocking `superRefine` rules; a display string is a different concern that would ride along with no coherence rule to satisfy. Decisively: a capability field can never serve a custom tool, because a custom tool has no capability row — so a resolver function is required regardless, and once it exists the map is better as its own pinned projection than as a 33rd field on the enforcement schema. It still lives in `packages/core/src/registries/`, which is what the PRD was reaching for.

### Decision 2 — Does the label resolve on the server or the client?

**A. Server resolves.** The `tool_call` event carries `{ type, toolCallId, toolName, phaseLabel }`. `portal.service` already reads the capability registry in `resolveDisplayBlock`.

**B. Client resolves.** The event carries `{ type, toolCallId, toolName }`; the frontend calls `toolPhaseLabel(toolName)`.

| | A (server) | B (client) |
|---|---|---|
| Display copy on the wire | Yes | No |
| Matches the existing `tool_result` → `streamingBlockFor` split | No | Yes |
| Copy change requires an API deploy | Yes | No |
| Event payload size | Two extra strings per step | Minimal |

**Lean: B.** The established shape for this stream is *semantic event in, presentation resolved in the client* — `tool_result` ships `toolName` and the client maps it through `streamingBlockFor` (`portal-stream.util.ts:38`). Keeping copy out of the contract also keeps the OpenAPI schema stable when labels get reworded.

### Decision 3 — How a step closes when the tool produces no display block

Today a non-display tool (`hypothesis_test`, `regression`, the `entity_management` writers) emits nothing on the wire, so a step opened by `tool_call` would never close.

**A. Widen `tool_result`.** Emit it for every tool-result chunk: add `toolCallId` to `ToolResultEventSchema` and make `result` optional — present when there's a display block, absent otherwise. One `tool_call` pairs with exactly one `tool_result`.

**B. A second new event.** `tool_call_end` (`{ type, toolCallId, toolName }`) emitted for every tool-result chunk, leaving `tool_result` byte-identical to today. Two lifecycle events plus, for a displaying tool, its unchanged `tool_result`.

**C. Client-side heuristic** — close the newest step when a `delta` arrives after it.

| | A (widen `tool_result`) | B (`tool_call_end`) | C (heuristic) |
|---|---|---|---|
| New event names | 1 (`tool_call`) | 2 | 1 |
| `tool_result` shape change | `toolCallId` added, `result` optional | **None** | `toolCallId` added |
| Contract change | Additive **+ widening** | Purely additive | Additive + widening |
| Events per displaying call | 2 | 3 | 2 |
| Lifecycle separable from payload | No — one event means both | Yes | No |
| Correct without server cooperation | — | — | No: a tool that emits no text after it never closes |

**Lean: B.** Chosen over A because it keeps the contract **purely additive** — no existing event changes shape, so no existing consumer, schema, or `portal.service.test.ts` event-filter assertion has to move. It also separates the two concerns cleanly: `tool_call` / `tool_call_end` are the step *lifecycle*, `tool_result` remains "here is a block to render", and the frontend reads each from one listener with no conditional interpretation. The cost is a third event name and one extra wire event per displaying tool call — two short strings, against a ceiling of 10 steps per turn.

### Decision 4 — In-flight step state in `usePortalStream`

The confirmed semantics are *most-recently-started step wins, falling back to the next still-open step when it closes* — which requires retaining the whole open set, not just the newest.

**A. `toolSteps: ToolStep[]` on `PortalStreamState`**, each `{ toolCallId, toolName, startedAt }`; `tool_call` appends, `tool_call_end` filters by `toolCallId`, terminal paths set `[]`. Active step = last element. Plain functional `useState` — no ref needed, since no handler reads the array (they only append, filter, or clear).

**B. `activeToolStep: ToolStep | null`.** Rejected: it cannot satisfy the fallback requirement.

**C. Convert the hook to `useReducer`** (as `BulkJobProgressBlock` does).

**Lean: A.** It's the minimum state that satisfies the fallback rule, needs no stale-closure ref, and leaves the hook's existing `useState` shape intact — a reducer conversion would rewrite four listeners and the hook's only test file for no behavioral gain.

### Decision 5 — Surfaces: the elapsed clock and where the strip mounts

No ticking clock exists anywhere in the app, so this is new. The pure-UI policy points one way: put the interval in the container and pass the number down, so both surfaces stay props-only and testable without timers.

- **Clock:** new `apps/web/src/utils/use-elapsed.util.ts` — `useElapsed(startedAt: number | null): number` returning whole seconds, one 1s `setInterval` that is not created while `startedAt` is null. Called **once** in the `PortalSession` container; `elapsedSeconds` is passed to both surfaces. `DateFactory.relativeTime` is unusable here (minute granularity).
- **Inline slot:** extend `TypingIndicator` with optional `label` and `elapsedSeconds` props rather than swapping in a second component — same slot, same `Paper`, same `data-testid`, existing test unaffected. `showTypingIndicator` becomes `isStreaming && (!hasStreamingContent || activeStep != null)`.
- **Strip:** a new `ToolActivityStrip.component.tsx` (pure UI), mounted through a new `statusStrip?: React.ReactNode` slot on `ChatWindowUIProps` (`:38`) and **absolutely positioned over the bottom of the scroll region, immediately above the composer's top border** — the same overlay technique as the existing jump-to-top/bottom buttons (`ChatWindow.component.tsx:193`/`:213`), not a row in the `flexShrink: 0` box.

**Lean: overlay, and it is a hard requirement rather than a preference.** The composer is a fixed-height region below a flexible feed, so a strip that *occupies* layout changes that region's height mid-turn: the text field moves under a user who may be typing into it, and the scroll viewport re-measures while the append-driven auto-scroll effect (`PortalSession.component.tsx:325-343`) is running — a jarring jump in the exact moment the feature exists to make calm. An overlay reflows nothing, ever. Anchoring it directly above the input also puts the signal where the user's attention already is, which is the point of the ticket: make it obvious that work is happening, so nobody is left wondering what's taking so long.

The cost is occlusion — the overlay covers the last strip-height of feed content while a tool runs. **Mitigation: a partial-width pill** (anchored to one side, with the theme's paper background and a subtle elevation) rather than a full-width bar, so streamed text remains readable beside it. Exact width/side/elevation is a spec detail.

The rejected alternatives: *mount-on-demand in the composer box* (reflows twice per tool turn — the failure above), and an *always-reserved empty row* (no reflow, but permanent dead space under every idle portal for a state that is transient).

One shared `ToolActivityStatus` component embedded in both surfaces was also considered and rejected — it saves two `Typography` lines and costs a third component plus a nesting layer inside `TypingIndicator`'s `Paper`.

## Tradeoff comparison

|  | D1: sibling registry | D2: client resolves | D3: `tool_call_end` | D4: step array | D5: container clock + overlay pill |
|---|---|---|---|---|---|
| Spread to spec | Yes — new core module + pin test | Yes — event payload fields | Yes — two new union variants | Yes — `PortalStreamState` addition | Yes — new hook, new slot prop, `TypingIndicator` props |
| Packages touched | `core` | `api`, `web` | `core`, `api`, `web` | `web` | `web` |
| Breaks an existing test | `tool-capabilities.test.ts` pin (extend) | No | No — additive only | `portal-stream.util.test.ts` (extend) | `TypingIndicator.test.tsx` (additive) |

## Recommendation

1. Add `ToolCallEventSchema` (`type: "tool_call"`, `toolCallId`, `toolName`) and `ToolCallEndEventSchema` (`type: "tool_call_end"`, `toolCallId`, `toolName`) to `packages/core/src/contracts/portal.contract.ts` and to the `PortalSSEEventSchema` union (`:292`). `ToolResultEventSchema` is **not** touched — the contract change is purely additive.
2. Emit `tool_call` from `handleToolCall` (`portal.service.ts:98`) after the text flush, and emit `tool_call_end` from `handleToolResult` (`:119`) for **every** tool-result chunk — unconditionally, before and independent of the existing `resolveDisplayBlock` branch, so a non-display tool still closes its step.
3. Bring the stream's documentation into sync — all six events, one source. Register each payload in `swagger.config.ts` from its Zod schema and expose a `PortalStreamEvent` `oneOf` union following the `QueryHandleStreamEvent` precedent (`:1497-1518`); `$ref` it from the router's `@openapi` 200 response in place of `schema: { type: string }` (`portal-events.router.ts:51`); **replace the stale hand-written prose list** (`:53-58` — it spells `tool_result`'s field as `name`, omits `stream_error`, and knows nothing of the two new events) with the registered names; and mirror the registration in `swagger.config.test.ts` per the round-trip rule (`swagger.config.ts:19-27`). The four pre-existing events are documented as part of this change, not just the two new ones — the block is wrong today and this PR is what touches it.
4. Add `packages/core/src/registries/tool-phase-labels.ts` with a curated label for all 33 built-in + system tool names and `toolPhaseLabel(name)` falling back to a name-derived label (`refresh_crm` → "Running refresh crm") for custom/webhook tools. Pin it with a key-set equality test against `ALL_TOOL_CAPABILITIES`, mirroring `tool-capabilities.test.ts:134`.
5. Extend `PortalStreamState` with `toolSteps: ToolStep[]`; a `tool_call` listener appends `{ toolCallId, toolName, startedAt: Date.now() }`, a `tool_call_end` listener filters by `toolCallId`, the existing `tool_result` listener (`:148`) is unchanged, and all four terminal paths (`done` `:163`, `stream_error` `:189`, `onerror` `:199`, `cancel` `:91`) clear the array.
6. Add `use-elapsed.util.ts` and call it once in the `PortalSession` container against `activeStep?.startedAt ?? null`; pass `label` + `elapsedSeconds` to both surfaces.
7. Extend `TypingIndicator` with optional `label`/`elapsedSeconds`, widen `showTypingIndicator` to keep the slot mounted while a step is active, and add `ToolActivityStrip.component.tsx` — a partial-width pill mounted through a new `statusStrip` slot and **absolutely positioned above the composer's top border**, so no layout shift and no scroll re-measure can occur mid-turn.
8. Nothing persists: no message-block change, no rehydration path. A mid-turn reload starts with an empty `toolSteps`, which satisfies the no-phantom-indicator criterion by construction.

## Open questions

1. **Does the strip appear during a tool-free text reply?** Now that it is an overlay (Decision 5), appearing and disappearing costs no reflow either way, so this is purely a question of noise. **Lean: only while a step is active.** A pure-text turn is already visibly streaming into the feed — a pill that says nothing but "thinking" over it adds occlusion for no information.
2. **A tool that errors never produces a `tool-result` chunk**, so no `tool_call_end` fires. The server already strips orphaned `tool-call` blocks at teardown (`portal.service.ts:698-705`), so its step stays open until `done`/`stream_error` clears it — the label lingers on a tool that has actually stopped. **Lean: accept it.** A per-step failure event would be a fourth event name for a case that ends the turn milliseconds later; the terminal clear is the backstop.
3. **Screen-reader noise.** `TypingIndicator` already carries `role="status"`; a label that changes per tool plus a second-by-second counter inside a live region would announce constantly. **Lean: announce the phase label only** — keep the label in the live region and mark the elapsed counter `aria-hidden`, so a phase transition is announced once and the ticking is silent.
4. **Do all 33 built-ins get curated copy, or only the slow ones?** **Lean: all of them**, enforced by the key-set pin. A partial map means the fallback path fires for built-ins, which is the "Running var cvar" copy we're adding the registry to avoid.
5. **Does `resolveDisplayBlock`'s `bulk-job-progress` branch double-report?** An escalated `sql_query` returns a progress block, so its step closes while the job keeps running behind a `BulkJobProgressBlock`. **Lean: correct as-is** — the step measures the *tool call*, and the block owns the job's progress. Unifying the two is explicitly out of scope on the ticket.

## Enterprise-scale considerations

- **Concurrency & correctness.** The only concurrency is multiple open steps in one turn, resolved by Decision 4 (append/filter keyed on `toolCallId`, newest wins). A single SSE connection delivers events in order, and the turn is bounded at 10 steps by `stepCountIs(10)` (`portal.service.ts:633`). No cross-request state, no check-then-act, no idempotency key needed.
- **Accuracy & auditability.** `N/A because` the trail is ephemeral by ticket decision. The durable record is unchanged: `tool-call` / `tool-result` blocks are still persisted into the assistant message (`portal.service.ts:715`). No billing, chargeback, or compliance consumer reads this signal.
- **Failure modes.** Fail-open in both directions, and the cost of failure is cosmetic. A dropped or absent `tool_call` degrades to exactly today's behavior (`EventSource` only dispatches to listeners you registered, so an older client ignores the new event and a newer client against an older server simply sees no steps). A dropped closing event leaves a stale label for the rest of the turn, cleared by `done`/`stream_error`/`onerror`/`cancel` — there is no state that can survive a turn.
- **Scale & unbounded growth.** Two extra events per tool call (≤10 steps per turn by `stepCountIs(10)`), each carrying two short strings — no tool output is added to the wire. One 1s interval per streaming client, created only while a step is open and torn down with the turn. `toolSteps` is bounded by the same step ceiling.
- **Multi-tenancy.** No shared or cross-org state. The one org-authored value that reaches the DOM is a custom tool's `name`, which is constrained by `TOOLPACK_SLUG_REGEX` to bounded snake_case (`organization-toolpack.model.ts:74-87`) and rendered as React text — **Lean: derive the fallback label from `name`, never from the free-prose `description`**, which is unbounded and server-mutated (`tools.service.ts:667-670`).
- **Contract stability.** `PortalSSEEventSchema` is a discriminated union, so `tool_call` and `tool_call_end` are purely additive variants — **no existing event changes shape** (Decision 3), which is why an older client is unaffected by construction: `EventSource` dispatches only to registered listeners, so unknown event names are dropped silently. The `toolPhaseLabel(name)` resolver is the other stable seam: an author-supplied label for custom packs (explicitly out of scope) plugs in behind it with no call-site change.
- **Data lifecycle.** `N/A because` nothing is written. No windows, no retention, no rehydration.

## What this doesn't decide

- **Author-supplied labels for custom toolpacks.** Out of scope on the ticket; the name-derived fallback ships, and `toolPhaseLabel` is where a label field would land later without touching consumers.
- **Rendering every concurrent step.** Parallel calls collapse to the newest open step; a stacked multi-row indicator is deferred (variable strip height above the composer, for a case the agent rarely produces).
- **Sub-tool internals.** No codegen attempt counters, row counts, or percentages — phase label and elapsed only. `D3Widget`'s own `Rendering N of M rows…` stays as-is.
- **Unifying with `bulk-job-progress`.** The escalated-`sql_query` surface keeps its own block; see open question 5.
- **Refactoring `PortalSession.component.tsx` into policy compliance.** It defines four components today; this ticket adds none to it and leaves the pre-existing violation alone rather than folding an unrelated refactor into a wire-format change.
- **A test harness for the stream hook's listeners.** The spec will need one (today's `portal-stream.util.test.ts` covers only the pure `streamingBlockFor`, and `PortalSession.test.tsx:80-89` stubs `sse.api` with a no-op EventSource) — but whether the capturable fake lands as a shared `__tests__` helper or inline per suite is a spec-level call.

## Next step

`docs/TOOL_ACTIVITY_INDICATOR.spec.md` fixes the contract: the `ToolCallEvent` / widened `ToolResultEvent` schemas, the `toolPhaseLabel` signature and the full built-in label table, the `PortalStreamState` addition, and the two components' props. `docs/TOOL_ACTIVITY_INDICATOR.plan.md` then slices it back-to-front, each slice a testable commit: (1) core contract + label registry with pins; (2) server emit + OpenAPI registration and the stale-prose fix; (3) hook step tracking behind a capturable EventSource fake; (4) the two surfaces and the elapsed hook; (5) doc-sync sweep (`glossary.util.ts` if "activity indicator" earns a term, plus the router/Swagger surfaces already in slice 2).
