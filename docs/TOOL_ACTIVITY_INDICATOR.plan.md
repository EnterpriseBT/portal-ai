# In-flight tool activity indicator — Plan

**TDD-sequenced implementation of the activity indicator: the two additive SSE events + the phase-label registry, the server emit, the OpenAPI sync, in-flight step tracking in `usePortalStream`, the three leaf UI pieces, and the container wiring.**

Spec: `docs/TOOL_ACTIVITY_INDICATOR.spec.md`. Discovery: `docs/TOOL_ACTIVITY_INDICATOR.discovery.md`. Issue: #279. No upstream dependency — this builds only on shipped code (`portal.service.ts` streaming loop, `usePortalStream`, `ChatWindowUI`).

Five slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/tool-activity-indicator`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api      && npm run test:unit
cd apps/web      && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — the contract is a leaf, so it lands first and everything else consumes it; producer before documenter; pure leaves before wiring:

- **Slice 1** — the core contract + the label registry. Pure, dependency-free; every later slice imports from it, so it carries no forward dep.
- **Slice 2** — the server emit. Puts the events on the wire; consumes slice 1's types. Nothing observes them yet.
- **Slice 3** — the OpenAPI sync (registration + the three `@openapi` corrections). Documents what slice 2 now emits; consumes slice 1's schemas.
- **Slice 4** — the hook's step tracking, behind a new capturable `EventSource` fake. Consumes slice 1's types; no UI reads `toolSteps` yet.
- **Slice 5** — the whole frontend surface: the three leaf UI pieces (clock hook, extended `TypingIndicator`, new `ToolActivityStrip`) *and* the wiring that mounts them (the `statusStrip` overlay slot + the container derivation). Neither half has a forward dependency on the other, so they land as one reviewable commit — the leaves would otherwise sit unmounted for a commit. First slice where the feature is user-visible; this is what the smoke walk exercises.

No migration and no seed — nothing is persisted (spec → *Migration / Seed*).

---

## Slice 1 — Core contract + phase-label registry

The two new SSE event schemas and the 33-tool label registry with its name-derived fallback. Pure `packages/core`; nothing emits or consumes yet.

**Files**

- Edit: `packages/core/src/contracts/portal.contract.ts` — `ToolCallEventSchema`, `ToolCallEndEventSchema`, both added to `PortalSSEEventSchema` (`:292`). `ToolResultEventSchema` untouched.
- New: `packages/core/src/registries/tool-phase-labels.ts` — `TOOL_PHASE_LABELS` (33 entries), `toolPhaseLabel()`, `deriveToolPhaseLabel()`, `MAX_DERIVED_LABEL_LEN`.
- Edit: `packages/core/src/registries/index.ts` — re-export the new module.
- Edit: `packages/core/src/__tests__/contracts/portal.contract.test.ts` — new SSE-event describe.
- New: `packages/core/src/__tests__/registries/tool-phase-labels.test.ts`.

**Steps**

1. **Tests (spec core cases, ≈16).** Contract: both new schemas parse a valid payload and reject a missing `toolCallId`; `PortalSSEEventSchema` discriminates all six `type`s; an unknown `type` fails; **`ToolResultEventSchema` still parses its current shape** (the no-regression pin for D3). Registry: `Object.keys(TOOL_PHASE_LABELS).sort()` equals `Object.keys(ALL_TOOL_CAPABILITIES).sort()`; every label non-empty, trimmed, uppercase-initial; `toolPhaseLabel("sql_query")` is curated; `toolPhaseLabel("refresh_crm")` → `"Running refresh crm"`; hyphens + repeated underscores collapse; over-long names truncate at `MAX_DERIVED_LABEL_LEN`; empty/whitespace → `"Running a tool"`. Run; fail.
2. **Implement** the two schemas, the union additions, the label map, and the two resolvers. Green.
3. Lint + type-check.

**Done when:** all core cases pass; `npm run build -w @portalai/core` succeeds so downstream `type-check` can resolve the new exports (see *Cross-slice notes*). Nothing imports the registry yet.

**Risk:** the key-set pin fails the moment the label map and `ALL_TOOL_CAPABILITIES` disagree — that's the point, but it means the 33 entries must be exactly the pinned set from `tool-capabilities.test.ts:88-134`, not a hand-typed guess.

---

## Slice 2 — Server emit

`handleToolCall` emits `tool_call`; `handleToolResult` emits `tool_call_end` for **every** tool-result chunk, independent of `resolveDisplayBlock`.

**Files**

- Edit: `apps/api/src/services/portal.service.ts` — the two `ctx.sse.send` calls, each behind the non-empty-`toolCallId` guard.
- Edit: `apps/api/src/__tests__/services/portal.service.test.ts` — extend `describe("streamResponse")` (`:824`), reusing `makeSse()` (`:285`) and the existing `sse.send` call-filter style.

**Steps**

1. **Tests (spec api cases, ≈6).** `tool_call` is sent with the chunk's `toolCallId` + `toolName`; **not** sent when `toolCallId` is missing/empty; `tool_call_end` is sent for a display-producing tool; **`tool_call_end` is sent for a non-display tool** whose `resolveDisplayBlock` returns `null` (the stats-only-turn regression the ticket names); `tool_call_end` precedes `tool_result` for the same call; `tool_result`'s payload is unchanged for a display tool. Run; fail.
2. **Implement** both emits per the spec's *Surface §3*. Green.
3. Lint + type-check.

**Done when:** the six cases pass and no existing `portal.service.test.ts` assertion changed — the additive-contract claim (D3) is only credible if the pre-existing suite is untouched.

**Risk:** emitting `tool_call_end` inside the `if (displayBlock)` branch by accident is the exact bug the fourth case exists to catch. Keep the emit above the `resolveDisplayBlock` call.

---

## Slice 3 — OpenAPI sync

Register all six portal-stream events + the `PortalStreamEvent` union, and fix the three errors in the router's `@openapi` block.

**Files**

- Edit: `apps/api/src/config/swagger.config.ts` — seven components, Zod-sourced with the existing `JSON_SCHEMA_OPTS` (`:69`).
- Edit: `apps/api/src/routes/portal-events.router.ts` — the `@openapi` block (`:23-71`): corrected path, six-event `description`, 200 response `$ref`.
- Edit: `apps/api/src/__tests__/config/swagger.config.test.ts` — extend the existing `components.schemas` + `swaggerSpec.paths` assertions (`:157-166`).

**Steps**

1. **Tests (spec api cases, ≈5).** The six event components + `PortalStreamEvent` are registered under `components.schemas`; `PortalStreamEvent.oneOf` holds exactly six `$ref`s; `paths["/api/sse/portals/{portalId}/stream"]` is defined **and** the old `/api/portals/{portalId}/stream` key is absent; the 200 `text/event-stream` schema is the `PortalStreamEvent` `$ref`. Run; fail.
2. **Implement** the registrations and the annotation corrections. Green.
3. Lint + type-check.

**Done when:** the five cases pass and `/api-docs` lists the stream under its real path with all six events.

**Risk:** `swaggerSpec` is built from the route JSDoc via `apis: ["./src/routes/*.ts"]` (`:1684`), a **cwd-relative** glob. The existing suite already asserts on `swaggerSpec.paths`, so this resolves under `cd apps/api && npm run test:unit` — but a path assertion that mysteriously sees zero paths means the glob didn't resolve, not that the annotation is wrong.

---

## Slice 4 — Hook step tracking

`toolSteps` on `PortalStreamState`, two new listeners, and clearing on all four terminal paths. Requires a **capturable** `EventSource` fake — today's suite only covers the pure `streamingBlockFor`.

**Files**

- Edit: `apps/web/src/utils/portal-stream.util.ts` — `ToolStep`, `toolSteps` on the state interface, the `tool_call` / `tool_call_end` listeners, `setToolSteps([])` in `send()` + `cancel` (`:91`), `done` (`:163`), `stream_error` (`:189`), `onerror` (`:199`).
- New: `apps/web/src/__tests__/portal-stream-tool-steps.test.ts` — the fake-EventSource harness + the cases.

**Steps**

1. **Tests (spec web cases, ≈10).** Build a fake `EventSource` that records `addEventListener` handlers so the test can dispatch named events. Then: a `tool_call` opens a step with `toolName` + numeric `startedAt`; a second `tool_call` makes the newer step **last**; `tool_call_end` on the newer id **falls back to the older step** (the D4 rule); `tool_call_end` on an unknown id is a no-op; a duplicate `tool_call` id doesn't duplicate the entry; `done` / `stream_error` / `onerror` / `cancel` each clear `toolSteps`; `send()` starts from `[]`. Run; fail.
2. **Implement** the state field and the listeners per the spec's *Surface §6* (filter-then-append keeps "newest is last" true and makes a duplicate id idempotent). Green.
3. Lint + type-check.

**Done when:** the ten cases pass. `toolSteps` is populated but nothing renders it — the hook's other consumers are unaffected.

**Risk:** the harness is new surface area. Keep it local to this test file; slice 5 needs the same capability for `PortalSession.test.tsx` and promotes it to a shared helper then (see *Cross-slice notes*).

---

## Slice 5 — Frontend surface: leaf UI + wiring

The user-visible slice. The three props-only pieces (clock hook, extended indicator, new strip) plus the wiring that mounts them: the overlay `statusStrip` slot on `ChatWindowUI` and the container derivation in `PortalSession`. Two test-first loops in one commit — the leaves would otherwise ship unmounted.

**Files**

- New: `apps/web/src/utils/use-elapsed.util.ts` — `useElapsed(startedAt: number | null): number`.
- New: `apps/web/src/__tests__/use-elapsed.util.test.ts`.
- Edit: `apps/web/src/components/TypingIndicator.component.tsx` — optional `label` / `elapsedSeconds`.
- Edit: `apps/web/src/__tests__/TypingIndicator.test.tsx`.
- New: `apps/web/src/components/ToolActivityStrip.component.tsx` — pure UI, no positioning of its own.
- New: `apps/web/src/__tests__/ToolActivityStrip.test.tsx`.
- Edit: `apps/web/src/components/ChatWindow.component.tsx` — `statusStrip?: React.ReactNode` on `ChatWindowUIProps` (`:38`), rendered absolutely inside the `position: relative` scroll container (`:181`), after the `showJumpBottom` block. The composer box (`:234`) is **not** modified.
- Edit: `apps/web/src/components/PortalSession.component.tsx` — `activeToolLabel` / `activeToolElapsedSeconds` on `PortalSessionUIProps` + `MessageListProps`; widened `showTypingIndicator` (`:64`); `statusStrip` passed to `ChatWindowUI`; container derives the last element of `toolSteps` by index (`apps/web` is ES2020 — no `Array.prototype.at`), calls `useElapsed` once, resolves `toolPhaseLabel`.
- Edit: `apps/web/src/__tests__/ChatWindowUI.test.tsx`, `apps/web/src/__tests__/PortalSession.test.tsx` — upgrade the `sse.api` stub (`:80-89`) to capture listeners; promote slice 4's fake `EventSource` to a shared `src/__tests__/__mocks__/` helper now that it has a second consumer.

**Steps**

1. **Leaf tests (spec web cases, ≈13).** Clock (`jest.useFakeTimers()`): returns 0 for `null`; registers no interval for `null`; advances 1 → 2 over two seconds; resets when `startedAt` changes; clears on unmount. Indicator: **no props renders exactly as today** (dots + `data-testid`, the backwards-compat pin); `label` renders as text; `elapsedSeconds` renders `18s`; the counter is `aria-hidden`; `aria-label` becomes the label when provided (Q3). Strip: renders label + elapsed; counter `aria-hidden`; `role="status"` with the label as `aria-label`. Run; fail.
2. **Implement the leaves** — the hook (reading `Date.now()` only inside the interval callback) and the two components. Green.
3. **Wiring tests (spec web cases, ≈8).** `ChatWindowUI`: `statusStrip` renders when provided, absent otherwise; its wrapper is absolutely positioned (**the overlay contract — no layout participation**); the composer `TextField` is still present and is not a sibling of the strip inside the composer box. `PortalSession`: driving `tool_call` shows the phase label inline **and** in the strip; `tool_call_end` + `done` clears both; `stream_error` clears both and leaves the error `StatusMessage`; Cancel clears both; a tool-free turn renders no strip (Q1). Run; fail.
4. **Implement the wiring** — the slot and the container derivation per the spec's *Surface §10–11*. Green.
5. Lint + type-check.

**Done when:** all ≈21 web cases pass — including the untouched-render pin on the existing `TypingIndicator` test — and the full ≈58-case suite is green across all three packages. The feature is user-visible and ready for `/smoke`.

**Risks.** Two, both worth watching:

- The overlay assertion is the load-bearing test for the issue's no-layout-shift criterion, and a DOM test can only prove `position: absolute` + placement, **not** the absence of a visual jump. The reflow claim is verified by hand in the smoke walk, not by jest.
- The clock is the app's first `setInterval` in a component path — assert the cleanup case, or a suite-wide open-handle leak surfaces later looking unrelated.

Because this slice carries both loops, step 2 must be green before step 3 starts; a single commit is not license to write all 21 tests up front against nothing.

---

## Sequence summary

| # | Slice | Package | Lands | Gating check |
|---|---|---|---|---|
| 1 | Core contract + label registry | `core` | Two event schemas, 33-label registry, fallback resolver | ≈16 cases; key-set pin vs `ALL_TOOL_CAPABILITIES` |
| 2 | Server emit | `api` | `tool_call` + `tool_call_end` on the wire | ≈6 cases; **no pre-existing assertion changed** |
| 3 | OpenAPI sync | `api` | 7 components + 3 `@openapi` corrections | ≈5 cases; correct path present, old path absent |
| 4 | Hook step tracking | `web` | `toolSteps` + 2 listeners + 4 terminal clears | ≈10 cases; newest-wins + fallback proven |
| 5 | Frontend surface: leaf UI + wiring | `web` | `useElapsed`, extended indicator, new strip, `statusStrip` overlay, container derivation | ≈21 cases (13 leaf → 8 wiring); full ≈58-case suite green |

Slices 1–4 are invisible to the user; slice 5 is the first with observable behavior.

## Cross-slice notes

- **Core rebuild between packages.** Jest maps `@portalai/core/*` to **source** (`apps/web/jest.config.js:45-52`, `apps/api/jest.config.js:31-32`), so slices 2–5 test green without rebuilding. But there are **no tsconfig path mappings**, so `tsc` resolves via package exports → `dist`: run `npm run build -w @portalai/core` after slice 1 (or run `type-check`/`lint` from the repo root, where turbo's `dependsOn: ["^build"]` handles it) or slices 2–5 fail type-check on a missing export. Same reason the dev stack needs the rebuild before the smoke walk.
- **The EventSource fake spans slices 4 and 5.** Slice 4 keeps it local to `portal-stream-tool-steps.test.ts`. Slice 5 needs the same capability in `PortalSession.test.tsx`, whose existing stub (`:80-89`) is a deliberate no-op. Promote the fake to a shared `src/__tests__/__mocks__/` helper **in slice 5**, when the second consumer actually exists — not speculatively in slice 4.
- **`Date.now()` discipline.** Two new capture points: the `tool_call` listener (slice 4) and the `useElapsed` interval callback (slice 5). Both are event handlers/effects, never render bodies — the rule `streamStartedAt` already follows (`PortalSession.component.tsx:377`).
- **Nothing to invalidate.** No mutation, no query key, no cache. The existing `handleStreamDone` invalidation (`:270-272`) is untouched.
- **Doc-sync (per `CLAUDE.md` → "Keeping Documentation in Sync").** Slice 3 *is* the developer-doc slice — the router annotation and Swagger registration are the documentation surface this feature changes. No tool capability, input, or semantics changed, so the three agent-facing surfaces (`*.tool.ts` descriptions, the `builtin-toolpacks.ts` mirror, `system.prompt.ts`) stay untouched: the label registry is display-only metadata the agent never sees. `glossary.util.ts` / `faq.util.ts` are checked at slice 5 — the feature makes an existing concept visible rather than introducing a new one, so the expected outcome is no change, **recorded rather than assumed**.
- **`portal.contract.test.ts` had no SSE coverage before this ticket.** Slice 1 adds the first, including the `ToolResultEventSchema` pin. That pin is what makes "purely additive" (D3) an enforced property rather than an intention.

## Next step

Implementation begins on `feat/tool-activity-indicator` — slice 1 first, tests before implementation, one commit per slice — **only after discovery, spec, and plan are reviewed and confirmed.** `/smoke 279` follows slice 5.
