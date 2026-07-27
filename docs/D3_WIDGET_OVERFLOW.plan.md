# D3 widget overflow & sizing — Plan

**Implements the sizing contract — available width in, painted extent out, vertical fit invariant — TDD-sequenced so the cropping visibly stops at slice 2 and the responsive path lands behind a fixed-point test at slice 3.**

Spec: `docs/D3_WIDGET_OVERFLOW.spec.md`. Discovery: `docs/D3_WIDGET_OVERFLOW.discovery.md`. Issue: #278. Builds on the shipped D3 widget module from epic #267 (#268 sandbox runtime, #270 refresh, #271 lazy mount/teardown), all now on `main`.

4 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/d3-widget-overflow`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly):

```bash
cd apps/web && npm run test:unit
cd apps/api && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Sequencing rationale.** Slice 1 is leaf work — the protocol field and the in-frame measurement — and is deliberately *inert*: the frame reports a width nobody reads yet, so nothing can regress. Slice 2 adds the pure sizing rule and has the frame consume the reported extent; this is the slice where cropping visibly stops, so it is the first point worth eyeballing in a browser. Slice 3 adds the responsive path (observer → coalesced `sendResize`), which is the only slice carrying a feedback-loop risk, so it lands last among the behavioral ones and brings the fixed-point assertion with it. Slice 4 (codegen prompt + protocol doc) touches no runtime code and is independent of 1–3 — it could land first, but sits last so the prompt describes behavior that already exists.

**On verification.** Per the spec's stated coverage gap, the in-frame measurement itself cannot be meaningfully unit-tested (jsdom has no layout and no `getBBox`/`getScreenCTM`, so an executed test exercises only the fallback branch). Measurement correctness and the visual churn from `overflow: visible` are therefore settled during the **manual smoke walk**, against the Sankey and beeswarm from the issue's repro — refining geometry and chasing residual visual bugs there is expected, not a sign the slices were wrong.

---

## Slice 1 — Report painted extent from inside the frame

Additive `width` on the two frame→parent messages, the `measureContent()` extent measurement replacing bare `root.scrollHeight`, and the sandbox CSS that lets escaped marks paint. Nothing consumes the new field yet.

**Files**

- Edit: `apps/web/src/modules/D3Widget/utils/bridge.util.ts` — optional `width` on `RenderedMessageSchema` / `ResizeMessageSchema`; `SandboxBridgeCallbacks` payloads widen; `rendered`/`resize` cases forward `width` when present (omitted-key style, matching `:177`).
- Edit: `apps/web/src/modules/D3Widget/utils/sandbox-bootstrap.js` — add `measureContent()`; report `{ height, width }` from `renderPass` (`:69`) and from the `ResizeObserver` (`:118-124`).
- Edit: `apps/web/src/modules/D3Widget/utils/sandbox-srcdoc.util.ts` — style block gains `#root svg{overflow:visible}` and `html,body{…overflow:hidden}`.
- Edit: `apps/web/src/modules/D3Widget/utils/__tests__/bridge.util.test.ts`, `…/__tests__/sandbox-bootstrap.test.ts`, `…/__tests__/sandbox-srcdoc.util.test.ts`.

**Steps**

1. **Tests (spec cases 1–4, 22–23).** Bridge: `rendered`/`resize` with `width` parse and forward it; the same messages **without** `width` still parse and forward no `width` key; `sendResize` posts `{ type: "resize", size }` (queued pre-`ready`, flushed after). Srcdoc: style block contains both new rules, `SANDBOX_CSP` unchanged, still no `http://`/`https://`. Bootstrap (source-string level): contains `getBBox`, `getScreenCTM`, `scrollWidth`, and still `new Function("api"`, `requestAnimationFrame`, `ResizeObserver`. Run; fail.
2. **Implement** the schema fields, the callback widening, `measureContent()` with its `try/catch` → `scrollWidth`/`scrollHeight` fallback, and the CSS. Green.
3. Lint + type-check.

**Done when:** cases 1–4 and 22–23 pass; the frame reports a width that **no consumer reads** — `D3SandboxFrame` still sizes off height alone, so behavior is unchanged apart from previously-clipped marks now painting.

**Risk:** the `overflow: visible` CSS is the one user-visible change landing here, and it lands *before* the frame grows to accommodate it — so between slices 1 and 2, escaped marks may paint over the widget's own chrome. Acceptable inside a single PR (no intermediate deploy), but don't smoke-test at this boundary; wait for slice 2.

---

## Slice 2 — Size the frame from the reported extent

The pure host-agnostic sizing rule, and the frame consuming it. **This is the slice where the cropping stops.**

**Files**

- New: `apps/web/src/modules/D3Widget/utils/widget-sizing.util.ts` — `resolveFrameSize(input): FrameSize`.
- New: `apps/web/src/modules/D3Widget/utils/__tests__/widget-sizing.util.test.ts`.
- Edit: `apps/web/src/modules/D3Widget/D3SandboxFrame.component.tsx` — `frameSize` state via `resolveFrameSize`; `containerWidthRef`; iframe style `width: frameSize.width` + `minWidth: "100%"`, `height: frameSize.height`, no `maxHeight`, no `overflowY`; `onRendered` prop type widens.
- Edit: `apps/web/src/modules/D3Widget/D3Widget.component.tsx` — `CHART_BOUNDS` gains explicit `overflowY: "visible"`.
- Edit: `apps/web/src/modules/D3Widget/__tests__/D3SandboxFrame.test.tsx`, `…/__tests__/D3Widget.test.tsx`, `…/__tests__/D3WidgetGate.test.tsx`.

**Steps**

1. **Tests (spec cases 5–9, 12–14, 19–21).** `resolveFrameSize`: content narrower than container → container width; wider → content width; height is always the painted height (never clamped); missing `contentHeight` → `fallbackHeight` and missing `contentWidth` → container width; non-finite/zero/negative inputs fall back rather than yielding `NaN`. Frame: a `rendered` with `width` > container sets the iframe's style width (with `minWidth: 100%`); a smaller `width` leaves it at container width; reported height sets the height with no `maxHeight`/`overflowY`. Host: `CHART_BOUNDS` renders `overflow-x: auto`, a non-scrolling `overflow-y`, and no `max-height`; `onHeight` still fires with the painted height; the gate placeholder still tracks the last painted height across an out-of-view → in-view cycle. Run; fail.
2. **Implement** `resolveFrameSize`, swap the frame's lone `frameHeight` state for `frameSize`, wire `onRendered`/`onResize` through it, and add the `CHART_BOUNDS` rule. Green.
3. Lint + type-check.

**Done when:** cases 5–9, 12–14 and 19–21 pass. A chart wider than the chat column now makes the wrapper scroll horizontally, and a tall chart is fully visible with no vertical scrollbar. **First point worth checking in a browser** — the issue's Sankey and beeswarm should both render complete, at the mount width.

**Risk:** the frame's init width is still the mount-time guess, so a widget that mounts before layout settles (or in a column narrower than `FALLBACK_FRAME_WIDTH = 640`) still lays out at the wrong width until slice 3. Expected at this boundary, not a regression — the pre-existing behavior.

---

## Slice 3 — Keep available width live (responsive reflow)

The parent-side observer that finally drives the shipped-but-unreachable `bridge.sendResize`, coalesced to one call per animation frame, with the fixed-point assertion that guards against a growth ratchet.

**Files**

- New: `apps/web/src/modules/D3Widget/utils/raf-coalesce.util.ts` — `rafCoalesce(fn)` with `cancel()`.
- New: `apps/web/src/modules/D3Widget/utils/__tests__/raf-coalesce.util.test.ts`.
- Edit: `apps/web/src/modules/D3Widget/D3SandboxFrame.component.tsx` — `ResizeObserver` on `iframe.parentElement`, callback wrapped in `rafCoalesce`, updating `containerWidthRef`, recomputing `frameSize`, and calling `bridge.sendResize({ width: containerWidth, height: INITIAL_FRAME_HEIGHT })`; disposed with the bridge; no-op when `ResizeObserver` is undefined.
- Edit: `apps/web/src/modules/D3Widget/__tests__/D3SandboxFrame.test.tsx`.

**Steps**

1. **Tests (spec cases 10–11, 15–18).** `rafCoalesce`: three calls in one frame → one invocation with the last value; synchronous invocation when `requestAnimationFrame` is unavailable; `cancel()` prevents a pending invocation. Frame: a container resize drives `sendResize` with the **container** width and `INITIAL_FRAME_HEIGHT` as the suggested height — never the painted height (the anti-ratchet assertion); **fixed point** — container W, frame reports content width 2W, iframe grows, the observer firing again still reports W so no grown width is ever sent and the size stabilizes; multiple observer ticks in one frame produce a single `sendResize`; `ResizeObserver` undefined → mounts and renders without throwing. Run; fail.
2. **Implement** `rafCoalesce` and the observer effect. Green.
3. Lint + type-check.

**Done when:** cases 10–11 and 15–18 pass. Narrowing/widening the window re-lays-out the chart at the new width without a remount, and a widget mounted in a sub-640px column lays out for its real width.

**Risk:** **the feedback loop is the failure mode of this whole design.** Three guards, all asserted: the observer measures the *wrapper* (which the iframe, being inside it, cannot widen), the suggested height sent is the constant `INITIAL_FRAME_HEIGHT` rather than the painted height, and case 16 pins the fixed point. If a chart oscillates during the smoke walk, this is the slice to suspect, and case 16's assumptions are the first thing to re-check.

---

## Slice 4 — Codegen guidance + protocol doc sync

Stops the prompt steering programs toward clipping geometry, and brings the sandbox spec back in line with shipped behavior. No runtime code.

**Files**

- Edit: `apps/api/src/prompts/visualize-d3.prompt.ts` — asymmetric axis semantics on the `api.width`/`api.height` lines (`:27-28`); **replace** the `:42` "Size to api.width / api.height so re-renders stay bounded" bullet; rework the worked example (`:48-62`) to derive height from `api.height` and to use tick-label-realistic margins.
- Edit: `apps/api/src/__tests__/prompts/visualize-d3.prompt.test.ts`.
- Edit: `docs/D3_SANDBOX_RUNTIME.spec.md` — protocol steps 4 (`:142`) and 6 (`:144`) report `{ height, width }`; the schema/callback sketch (`:155-160`) carries the optional `width`; a line recording the sizing contract and why `v: 1` is retained.

**Steps**

1. **Tests (spec cases 24–26).** The system prompt states the asymmetric axis semantics; it no longer contains the "stay bounded" instruction; the worked example derives height from `api.height` rather than hardcoding `260`. Run; fail.
2. **Implement** the prompt edits and the spec-doc update. Green.
3. Lint + type-check.

**Done when:** cases 24–26 pass, and `docs/D3_SANDBOX_RUNTIME.spec.md` describes the protocol as shipped (doc-sync convention satisfied in the same PR).

**Risk:** none to runtime. The prompt change is only *advisory* — an LLM can ignore it. That's why it isn't the fix: slices 1–3 make a too-tight program self-correct on its next render pass regardless of what the prompt says (discovery OQ 6).

---

## Sequence summary

| Slice | What lands | Gating check |
|---|---|---|
| 1 | Optional `width` on `rendered`/`resize`; `measureContent()`; SVG `overflow: visible`; frame shows no own scrollbars | Cases 1–4, 22–23 — inert, no consumer |
| 2 | `resolveFrameSize` + frame sized from painted extent; `CHART_BOUNDS` vertical rule | Cases 5–9, 12–14, 19–21 — **cropping stops; first browser check** |
| 3 | `rafCoalesce` + observer → `sendResize`; anti-ratchet + fixed point | Cases 10–11, 15–18 — responsive reflow |
| 4 | Prompt axis semantics + worked example; sandbox spec protocol sync | Cases 24–26 — doc-sync |

**Totals ≈ 26 cases** (web ≈ 23, api ≈ 3), matching the spec's test plan.

## Cross-slice notes

- **`FrameSize` / `FrameSizeInput` span slices 2–3.** Slice 2 introduces them and slice 3 only consumes them — no signature change at the boundary.
- **Don't smoke-test at the slice 1 boundary.** `overflow: visible` lands there while the frame still can't grow, so marks may paint over chrome. Slice 2 is the first coherent visual state.
- **The bootstrap stays source-string-tested by design** (jsdom has no layout / `getBBox`); the smoke walk is the real verification of `measureContent`. Expect to refine geometry there.
- **Visual churn is expected and accepted** (discovery OQ 4): previously-clipped marks now paint, so some existing charts will look different. The smoke walk should compare several chart forms rather than only the two repro cases.
- **Known limitation, not addressed:** content painted at negative coordinates stays clipped — extents are measured from `#root`'s origin, so growing the frame can't reveal it. If the smoke walk surfaces a real instance, file it rather than widening this ticket.
- **Doc surfaces in this PR:** `docs/D3_SANDBOX_RUNTIME.spec.md` (slice 4). No user-facing help/glossary surface changes — no new domain concept, no workflow step, no validation rule. The codegen prompt is the agent-contract surface and is covered by slice 4; there is no `builtin-toolpacks.ts` mirror to update, since nothing about the `visualize_d3` tool's capability or inputs changes.
- **No migration, no seed** — nothing DB-touching in this ticket.

## Next step

Implementation begins on `fix/d3-widget-overflow`, slice 1 first, tests-first, one commit per slice — once discovery, spec, and plan are reviewed and confirmed. `/smoke 278` scaffolds the walkthrough checklist after slice 4, and per the note above it is where measurement geometry and residual visual bugs get settled.
