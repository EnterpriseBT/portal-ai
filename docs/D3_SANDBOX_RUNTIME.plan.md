# Sandboxed D3 render runtime + `d3` block renderer — Plan

**TDD-sequenced implementation of the epic-foundation runtime: the `d3` block contract in core, the sandbox srcdoc + in-frame bootstrap + postMessage bridge, the progressive paged data path, the frame/widget components, and the registry wire-up.**

Spec: `docs/D3_SANDBOX_RUNTIME.spec.md`. Discovery: `docs/D3_SANDBOX_RUNTIME.discovery.md`. Issue: #268 (epic #267). Greenfield — no shipped dependency beyond the existing block registry and portal-sql handle endpoints.

Five slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/d3-sandbox-runtime`** (base `epic/d3-dashboard-widgets`) — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — contract first, then pure frame-side machinery, then the data path, then React, then the wire-up:

- **Slice 1** — core contracts. Everything else imports these types; also the only slice touching `packages/core`.
- **Slice 2** — sandbox document + bootstrap + bridge + theme (pure utils, the bulk of the tests). Theme lands here (not with the components) because the bridge's `init` type references `D3SandboxTheme` — keeping it later would be a forward dep.
- **Slice 3** — the progressive data path (SDK paged read + hook), independent of the frame.
- **Slice 4** — the React components composing 2 + 3.
- **Slice 5** — registration + stories. **#269 unblocks after this slice** (a minted `d3` block renders end-to-end).

No migration, no seed, no `apps/api` change.

---

## Slice 1 — core contracts: `d3` block type + `D3BlockContentSchema` + envelope split + barrel

The epic's shared contract. Nothing renders yet.

**Files**

- Edit: `packages/core/src/contracts/portal.contract.ts` — `"d3"` in `PortalBlockTypeSchema` (+ doc-comment line).
- Edit: `packages/core/src/contracts/portal-sql.contract.ts` — split `QueryHandleEnvelopeFieldsSchema` (bare object) from `QueryHandleEnvelopeSchema` (fields + existing `superRefine`, verbatim).
- New: `packages/core/src/contracts/d3-widget.contract.ts` — `D3ProgramParamsSchema`, `D3InlineContentSchema`, `D3HandleContentSchema`, `D3BlockContentSchema` (handle branch first).
- Edit: `packages/core/src/contracts/index.ts` — add `portal-sql.contract.js` (missing today) + `d3-widget.contract.js`.
- Edit: `packages/core/src/models/tool-capability.model.ts` — `"d3"` comment → `// sandboxed D3 render program (#268)` (comment only).
- New: `packages/core/src/__tests__/contracts/d3-widget.contract.test.ts`; edit: existing portal-contract + `ContentBlockRenderer` tests.

**Steps**

1. **Tests (spec cases 1–7).** Inline/handle/union parsing + rejections (1–3); envelope refinement regression post-split (4); barrel imports resolve (5); `PortalBlockTypeSchema` has `"d3"`, `PINNABLE_BLOCK_TYPES` doesn't (6); registry round-trip — register a stub `d3` renderer in-test, `ContentBlockRenderer` dispatches it (7). Run; fail.
2. **Implement** the schema split, the new contract file, the enum addition, the two barrel lines. Green.
3. Lint + type-check (repo root — the split touches a schema `apps/api` re-declares but does not import; type-check proves no consumer broke).

**Done when:** cases 1–7 pass; `@portalai/core/contracts` exports the new schemas; nothing in `apps/web` references them yet.

**Risk:** the barrel addition of `portal-sql.contract.js` could collide with an existing export name elsewhere in the barrel. Check with type-check at the boundary; the file exports only `QueryHandleEnvelope*` names (verified unique).

---

## Slice 2 — sandbox srcdoc + bootstrap + bridge + theme (pure utils)

The containment core: the frame document, the in-frame program lifecycle, and the parent-side bridge. No React, no network.

**Files**

- New: `apps/web/src/modules/D3Widget/utils/sandbox-srcdoc.util.ts` — `SANDBOX_CSP`, `buildSandboxSrcdoc({ d3Source, bootstrapSource })`, `SANDBOX_SRCDOC` (from `?raw` imports).
- New: `apps/web/src/modules/D3Widget/utils/sandbox-bootstrap.js` — the in-frame script (ready → init/nonce → data accumulation → rAF-coalesced `new Function("api", …)` invoke → rendered/error/resize messages, per spec behavior contract 1–7).
- New: `apps/web/src/modules/D3Widget/utils/bridge.util.ts` — message schemas, `BRIDGE_PROTOCOL_VERSION`, `RENDER_TIMEOUT_MS`, `D3_SNAPSHOT_PAGE_SIZE`, `createSandboxBridge`.
- New: `apps/web/src/modules/D3Widget/utils/sandbox-theme.util.ts` — `D3SandboxTheme`, `buildSandboxTheme`.
- New: `apps/web/src/__tests__/raw-stub.js`; edit: `apps/web/jest.config.js` (`"\\?raw$"` mapper).
- Edit: `apps/web/package.json` — `d3` pinned exact (`npm install --save-exact d3@7.9.0`).
- New: `apps/web/src/modules/D3Widget/utils/__tests__/` — srcdoc, bridge, theme, bootstrap-marker tests.

**Steps**

1. **Tests (spec cases 8–15, 18, 19).** srcdoc: CSP meta + injected sources + doctype (8), no external URL substrings (9). Bridge: init-after-ready with nonce (10); wrong source/nonce ignored (11); `sendData` shape + ordering (12); watchdog timeout → `onError`, `rendered` cancels (13, fake timers); callback dispatch + malformed-payload drop (14); `dispose` (15). Theme mapping from a real brand theme (18). Bootstrap source markers (19). Run; fail.
2. **Implement** the four utils + the bootstrap script. Bridge tests run against a stub iframe object (`{ contentWindow: { postMessage: jest.fn() } }`) + synthetic window `message` events — the resolved-Q5 mocked boundary.
3. Green; lint + type-check.

**Done when:** cases 8–15, 18, 19 pass; `SANDBOX_SRCDOC` builds from the real `?raw` imports under Vite (spot-check via `npm run build -w @portalai/web` or the dev server); nothing imports the module yet.

**Risk:** the `?raw` jest mapper must not swallow non-raw `.js` imports — the pattern is anchored to the query suffix. The bootstrap is plain JS excluded from TS compilation but included in lint-staged's prettier glob; keep it prettier-clean.

---

## Slice 3 — progressive data path: SDK paged read + `useProgressiveHandleRows`

The batched fetch that feeds the frame. Independent of slices 2's frame machinery.

**Files**

- Edit: `apps/web/src/api/portal-sql.api.ts` — `handleSnapshotPage` (imperative `useAuthMutation`, `method: "GET"`, URL from vars). `handleSnapshot` untouched.
- New: `apps/web/src/modules/D3Widget/utils/progressive-rows.util.ts` — `ProgressiveRowsState`, `useProgressiveHandleRows(queryHandle)`.
- New: `apps/web/src/modules/D3Widget/utils/__tests__/progressive-rows.util.test.ts`.

**Steps**

1. **Tests (spec cases 16–17).** Mocked SDK (ESM `jest.unstable_mockModule` per house pattern): pages of `D3_SNAPSHOT_PAGE_SIZE` from offset 0, ordered batch emission, `complete` on short page, `receivedRows` accounting (16); `READ_HANDLE_EXPIRED` → expired-cache copy, other errors passthrough, no paging after error/unmount (17). Run; fail.
2. **Implement** the SDK endpoint + the hook (loop drives `mutateAsync` sequentially; cancellation flag on unmount).
3. Green; lint + type-check.

**Done when:** cases 16–17 pass; the hook is consumed by nothing yet.

**Risk:** the paging loop must be strictly sequential (no parallel pages — ordered `seq` is the bridge contract). The test's mock resolves out-of-order to prove ordering is enforced by the loop, not by luck.

---

## Slice 4 — components: `D3SandboxFrameUI` + `D3WidgetUI` / `D3Widget`

The React layer composing slices 1–3. Per the Component File Policy: frame = single pure-UI file; widget = pure UI + container pair.

**Files**

- New: `apps/web/src/modules/D3Widget/D3SandboxFrame.component.tsx` — `D3SandboxFrameUI` (iframe + bridge lifecycle + height tracking).
- New: `apps/web/src/modules/D3Widget/D3Widget.component.tsx` — `D3WidgetUI` (error card / loading / frame + progress caption) + `D3Widget` container (content parse → inline single-batch vs. handle hook; `useTheme` → `buildSandboxTheme`).
- New: `apps/web/src/modules/D3Widget/__tests__/D3SandboxFrame.test.tsx`, `D3Widget.test.tsx`.

**Steps**

1. **Tests (spec cases 20–24).** Frame: `sandbox` attr exactly `allow-scripts`, `srcDoc === SANDBOX_SRCDOC` (20). Widget UI: loading state, progress caption with "N+" truncation rule, caption gone on complete (21); error card testid + message, frame unmounted (22). Container: inline content → one done batch, zero SDK calls (23); handle content → batches from mocked paged SDK, envelope `rowCount`/`truncated` forwarded (24). Run; fail.
2. **Implement** the two component files. `D3WidgetUI` drives everything through props (no SDK/context — tests need no provider mocks); the container owns `sdk`/`useTheme` wiring.
3. Green; lint + type-check.

**Done when:** cases 20–24 pass; components exist but nothing routes `d3` blocks to them yet.

**Risk:** bridge lifecycle inside `D3SandboxFrameUI` (create/dispose on mount/unmount, forward new batches without re-creating the frame) — the effect dependency list is the bug surface; test 20 + the bridge dispose test (15) fence it.

---

## Slice 5 — registration, barrel, stories

The wire-up: `d3` blocks render end-to-end in the app.

**Files**

- New: `apps/web/src/modules/D3Widget/utils/register.util.ts` — `registerD3BlockRenderer()` (idempotent).
- New: `apps/web/src/modules/D3Widget/index.ts` — barrel (components, prop types, register fn, bridge/theme types).
- Edit: `apps/web/src/main.tsx` — call `registerD3BlockRenderer()` before `createRoot`.
- New: `apps/web/src/modules/D3Widget/stories/D3Widget.stories.tsx` — pure-UI stories: rendered program (real browser executes the frame), progressive/loading, error card, themed variants.
- New: `apps/web/src/modules/D3Widget/__tests__/register.util.test.ts`.

**Steps**

1. **Tests (spec case 25).** `registerD3BlockRenderer()` → `hasBlockRenderer("d3")`; idempotent double-call; renderer yields a `D3Widget` element for a `d3` block. Run; fail.
2. **Implement** register util + barrel + `main.tsx` line.
3. **Stories** against `D3WidgetUI`/`D3SandboxFrameUI` with a small fixture program (e.g. a bar chart over 20 inline rows) — this is the real-browser execution surface for the bootstrap (resolved Q5); verify in `npm run storybook` (web, :7007) that the fixture renders and an intentionally-throwing story shows the error card.
4. Green; lint + type-check; full `npm run test` at repo root.

**Done when:** case 25 passes; a hand-built `d3` block pasted into a portal message fixture renders through the registry in the dev app; stories render in web Storybook. **#269 can now mint blocks against a live renderer.**

**Risk:** none structural — registration is additive; a `d3` block simply rendered `null` before this slice.

---

## Sequence summary

| Slice | Lands | Spec cases | Tests |
|---|---|---|---|
| 1 | core contracts + barrel + envelope split | 1–7 | core unit |
| 2 | srcdoc + bootstrap + bridge + theme utils (+ `d3` dep, jest `?raw`) | 8–15, 18, 19 | web unit |
| 3 | `handleSnapshotPage` + `useProgressiveHandleRows` | 16–17 | web unit |
| 4 | `D3SandboxFrameUI` + `D3WidgetUI`/`D3Widget` | 20–24 | web unit |
| 5 | registration + barrel + stories | 25 | web unit + Storybook |

Total ≈ **25 cases**, no migration. Commits on `feat/d3-sandbox-runtime`; PR (opened after these docs are confirmed) grows commit-by-commit.

---

## Cross-slice notes

- **Security assertions are split across slices**: the CSP/no-egress guarantees are pinned by slice 2's string-level tests; the *behavioral* proof (blocked fetch, no cookie access) is the smoke checklist's manual browser walk — `/smoke` maps it from the spec's acceptance criteria after slice 5.
- **`D3_SNAPSHOT_PAGE_SIZE` (1000) deliberately mirrors the handle service's Redis batch grain** — if the server constant ever changes, nothing breaks (it's just a page size), but the alignment note lives in `bridge.util.ts`'s JSDoc.
- **The envelope split (slice 1) must not change runtime behavior** — `QueryHandleEnvelopeSchema`'s parse results are byte-identical; only composability is added. The api-side duplicate stays (its consolidation belongs to #269/#270).
- **Doc-sync check:** this child ships no user-visible capability (no tool mints `d3` blocks until #269), so glossary/FAQ/help stay untouched **by design**; the agent/tool surfaces update in #269, and Vega copy is #272's sweep. The module's own README-level docs live as JSDoc in the barrel + utils.
- **Prettier/lint:** `sandbox-bootstrap.js` is plain JS inside `src/**` — lint-staged will format it; keep it syntactically standalone (no imports/exports) so neither Vite nor jest tries to graph it (it's only ever read via `?raw` / stubbed).
- **CLAUDE.md compliance:** Module Pattern layout, Component File Policy (pure UI + container pair, `UI` suffix), SDK-helper rule (`useAuthMutation` GET for the imperative paged read), npm-scripts-only testing.

---

## Next step

Implementation starts on this branch once discovery + spec + plan are confirmed: slice 1 first, tests-first, one commit per slice (`feat(core): …`, `feat(web): …` per slice scope).
