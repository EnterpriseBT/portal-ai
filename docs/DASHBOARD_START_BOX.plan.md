# Dashboard start box — Plan

**TDD-sequenced implementation of the dashboard's start box, in five steps:**
1. one portal message limit;
2. creating a portal with its first message (core and API);
3. the portal page resuming a pending turn and holding a refused question;
4. the start box's search and validation, through the shared launcher;
5. the dashboard wiring that replaces its own create path.

Spec: `docs/DASHBOARD_START_BOX.spec.md`. Discovery: `docs/DASHBOARD_START_BOX.discovery.md`. Issue: #1079 (epic #1085). It builds on two tickets merged into the epic:
- **#1123:** `StartBoxUI`, `StationPickerUI` and core `Composer`.
- **#1078:** the workbench's empty `start` slot.

There are five slices. Each sits behind a green test suite and leaves the repo compilable. They land as **commits on `feat/1079-dashboard-start-box` / PR #1137**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration -- --testPathPattern 'portal.router.integration|agent-turn-gate'
cd apps/web && npm run test:unit -- --testPathPattern '<files>'
```

Each slice:
1. Write failing tests.
2. Make the smallest change that turns them green.
3. Run them in a focused run.
4. At the boundary, rebuild core when it changed (`npm run build --workspace @portalai/core`), then run `npm run lint && npm run type-check`.
5. Move to the next slice.

**Sequencing rationale.** Contract first, then the server that honours it, then the portal page that receives its outcome, then the box that sends it, then the page that hosts the box. Each layer reads only what an earlier slice shipped.

- **Slice 1: core contracts and `Composer` `error`.** These are leaf changes. Everything after imports `portalMessageField`, `StartPortalBodySchema` and `InitialMessageOutcome`.
- **Slice 2: the API create-with-message.** The server half of D1, D2 and D4. After this slice, a caller with `curl` can create a portal holding its first question.
- **Slice 3: `PortalSession` resume and the refused draft.** D3 and the receiving half of D2. (The code review narrowed the resume to the new portal's first question, so the reload case it once covered isn't.)
- **Slice 4: the start box path.** `StationPicker` search, `StartBoxUI` validation and the launcher's `startBox`. Nothing renders it on the dashboard yet.
- **Slice 5: the dashboard wiring and docs.** `DashboardStartBox`, the removed dashboard create path and the help copy.

No migration and no seed.

---

## Slice 1: the portal message limit and create contracts

Core only. No caller reads the new fields yet, so the API and web compile unchanged.

**Files**

- Edit: `packages/core/src/contracts/text-limits.contract.ts`. Add `PORTAL_MESSAGE_MAX_LENGTH` and `portalMessageField`.
- Edit: `packages/core/src/contracts/portal.contract.ts`. Add `initialMessage?` on `CreatePortalBodySchema`, plus `StartPortalBodySchema`, `InitialMessageOutcomeSchema`, the response's optional `initialMessage`, and `SendMessageBodySchema.message` from `portalMessageField`.
- Edit: `packages/core/src/ui/Composer.tsx`. Add `error?: string | null`, which sets `aria-invalid`, renders the error text and adds it to `aria-describedby`.
- Edit tests:
  - `packages/core/src/__tests__/contracts/text-limits.contract.test.ts`
  - `packages/core/src/__tests__/contracts/portal.contract.test.ts`
  - core `Composer.test.tsx`

**Steps**

1. **Tests (spec, Core: about 13 cases).**
   - `portalMessageField`: it trims, rejects blank, accepts exactly 20,000 characters and rejects 20,001.
   - The create body with and without `initialMessage`, and with an unknown key.
   - `StartPortalBodySchema`'s two messages.
   - Both outcome arms.
   - The send body over the limit.
   - `Composer` `error`: `aria-invalid`, the description, no `maxLength`, and axe.

   Run them; they fail.
2. **Implement** the schemas and the prop. The two guards stay green as they are: `name-length.guard.test.ts` and `strict-request-bodies.test.ts`.
3. Rebuild core, then run lint and type-check at the root. API and web compile, since every addition is optional.

**Done when:** the core cases pass. `npm run type-check` passes in api and web.

**Risk:** `SendMessageBodySchema` now trims. Nothing downstream depends on untrimmed input, because `PortalSession.handleSubmit` already trims.

---

## Slice 2: create a portal with its first message (API)

**Files**

- Edit: `apps/api/src/services/agent-turn-ceiling.service.ts`. Add `static refusalMessage(denial)`.
- Edit: `apps/api/src/services/portal.service.ts`. `createPortal` takes `initialMessage?` and keeps a fixed order:
  1. validate;
  2. `checkAdmission` when there's a message;
  3. `DbService.transaction` for the portal plus the user row;
  4. return the outcome.

  `CreatePortalResult.initialMessage?` carries that outcome.
- Edit: `apps/api/src/routes/portal.router.ts`.
  - **Create:** passes `initialMessage` through and returns `initialMessage` in its 201.
  - **Send:** uses `refusalMessage`.
  - **OpenAPI:** the create block references the registered components, and the existing `POST /:id/messages` block references `SendMessageBody` and documents its 429.
- Edit: `apps/api/src/config/swagger.config.ts`. Register `CreatePortalBody`, `InitialMessageOutcome` and `SendMessageBody`.
- Edit tests:
  - `apps/api/src/__tests__/services/agent-turn-ceiling.service.test.ts`
  - `apps/api/src/__tests__/__integration__/routes/portal.router.integration.test.ts`
  - `apps/api/src/__tests__/__integration__/routes/agent-turn-gate.integration.test.ts`

**Steps**

1. **Tests (spec, API: about 13 cases).**
   - `refusalMessage` for the day and minute windows.
   - Create with a message → `pending`, with one trimmed user row.
   - Create without one → as today.
   - Blank or 20,001 characters → `400` naming "Initial message", with no portal.
   - A station with no tools → `400`, and the ceiling window is unchanged.
   - An unreadable station → `404`.
   - Send with 20,001 characters → `400` naming "Message".
   - At the ceiling: the second create → `201 refused`, with zero messages and the same text the send route uses.
   - A failed message insert leaves no portal.

   Run them; they fail.
2. **Implement** in order: `refusalMessage` (and the send route's switch to it, with no behaviour change), then `createPortal`, then the route, then OpenAPI. Green.
3. Run lint and type-check. Also run `route-authorization.map` and the OpenAPI guard tests, if they're in the unit suite.

**Done when:** the API cases pass. The existing `portal.router.integration` and `agent-turn-gate` cases are unchanged and green. Swagger at `/api/docs` shows both routes.

**Risk:** the "no tools" check must run before `checkAdmission`, or a refused create burns a turn. The ceiling-window case pins it. `createPortal`'s `buildStationContext` stays outside the transaction (it reads only).

---

## Slice 3: the portal page resumes a pending turn and holds a refused question

**Files**

- New: `apps/web/src/utils/portal-initial-message.util.ts`. It holds the `HistoryState` augmentation (`refusedInitialMessage?`) and `readRefusedInitialMessage(state)`.
- Edit: `apps/web/src/components/ChatWindow.component.tsx`. `ChatWindowHandle.setDraft(text)` sets the value and focuses the end.
- Edit: `apps/web/src/components/PortalSession.component.tsx`.
  - **Resume:** once per `portalId`, behind a ref guard, when the newest server message is a user row, `capabilities.write` holds and nothing is streaming.
  - **Refused draft:** on mount, it seeds the composer, sets the turn-limit notice and replaces the history entry without the state.
- Edit tests: `apps/web/src/__tests__/ChatWindowUI.test.tsx` and `apps/web/src/__tests__/PortalSession.test.tsx`.

**Steps**

1. **Tests (spec, web: `ChatWindowUI` 1 case, `PortalSession` about 6 cases).**
   - `setDraft` fills and focuses the composer.
   - A newest user row with write resumes exactly once, including across a refetch.
   - Neither an assistant-newest portal nor a reader resumes.
   - A refused-state mount seeds the composer and shows the notice, and the state is cleared.
   - A successful send clears the notice.

   Run them; they fail.
2. **Implement** the util, `setDraft` and the two effects. Each effect reads its promise and calls no `mutate` (the `effect-mutation.guard`); `streamActions.send` isn't a mutation.
3. Run lint and type-check.

**Done when:** these cases and the existing `PortalSession`/`ChatWindowUI` suites pass. Manually, a portal created by slice 2's API with a message answers when opened.

**Risk:** a resume that re-fires on refetch would open repeated streams. The guard is keyed on `portalId` and the "exactly once across a refetch" case pins it. The server replays an answered turn (#504) as a backstop.

---

## Slice 4: the start box path (picker search, validation, launcher)

**Files**

- Edit: `apps/web/src/components/StationPicker.component.tsx`. Add the optional `search` prop: a search field, `results` for a typed query, and the "Searching…" and "No stations match" states. Without the prop, nothing changes.
- Edit: `apps/web/src/components/StartBox.component.tsx`.
  - `onStart(body: StartPortalBody)`, with `stationSearch?` passed through to the picker.
  - `validateWithSchema(StartPortalBodySchema)` on submit, with touched/errors (the prompt is touched on blur), `Composer` `error` and `focusFirstInvalidField`.
  - A picked station's option is remembered so it stays named.
- Edit: `apps/web/src/utils/use-portal-launcher.util.ts`.
  - `start` records its surface (`launch | chooser | startBox`), and only `launch` toasts.
  - Adds `startBox: { onStart, serverError }`.
  - A refused outcome navigates with `refusedInitialMessage` state.
  - The `PortalLauncher` type in `portal-launcher.context.ts` follows if it's declared there.
- Edit stories: `StationPicker` (a search story) and `StartBox` (a validation-error story, and `onStart`'s new shape) under `apps/web/src/stories/`.
- Edit: `packages/core/src/ui/Composer.tsx` gains `onBlur` (the start box marks the prompt touched on it), with a case in `Composer.test.tsx`. Rebuild core.
- Edit tests: `StationPicker.test.tsx` and `StartBox.test.tsx`; new `use-portal-launcher.start-box.test.tsx` for the launcher cases (the existing util test mocks nothing). Also update any test or fixture that builds a `PortalLauncher` literal (header, palette) for the new `startBox` field.

**Steps**

1. **Tests (spec, web: `StationPicker` about 4, `StartBox` about 6, launcher about 5).**
   - **Search:** typing calls `onQueryChange`; results replace the list; the empty and searching states render; with no `search` prop the menu is unchanged; axe on the open menu.
   - **Start box:** a valid submit sends a trimmed body; 20,001 characters shows the error, `aria-invalid` and focus, and doesn't send; errors appear only after blur or submit; `serverError` keeps the prompt; Enter and Shift+Enter behave as before; axe with errors showing.
   - **Launcher:** `startBox.onStart` posts `{ stationId, initialMessage }`; `pending` navigates plainly; `refused` navigates with state; a start-box error stays out of the chooser and raises no toast; a `launch` failure still toasts.

   Run them; they fail.
2. **Implement** the three changes. Green.
3. Run lint and type-check. The `dialog-contract`, `action-gate` and `component-axe` guards stay green.

**Done when:** these cases pass. The header launcher, the chooser and the palette suites are unchanged and green, and Storybook renders the new stories.

**Risk:** the chooser's error shown in the start box (or the reverse) would be confusing. The surface-scoped error case pins it.

---

## Slice 5: the dashboard hosts the start box (and docs)

**Files**

- New: `apps/web/src/components/DashboardStartBox.component.tsx`. A container around `StartBoxUI`:
  - it reads `usePortalLauncherContext()`;
  - its stations are the favorites plus the launcher's station;
  - it preselects `launcher.station?.id`;
  - its search is a debounced `sdk.stations.list({ search, limit: 10, … })`, enabled only while a query is typed.
- Edit: `apps/web/src/views/Dashboard.view.tsx`.
  - `DashboardViewUI` drops `onNewPortal` and its header Open Portal button, and adds a `startBox` slot that goes into the workbench's `start` slot.
  - The container removes `createMutation`, `createOpen`, `handleCreateSubmit` and `CreatePortalDialog`, and renders `<DashboardStartBox />`.
- Edit: the dashboard stories that passed `onNewPortal` or Open Portal.
- Docs:
  - `apps/web/src/utils/getting-started.util.ts:47`
  - `packages/core/src/content/faq.util.ts:72,79`
  - `glossary.util.ts:372` (Portal)
  - `troubleshooting.util.ts:121-132` (a refused first question)
- Tests:
  - new `apps/web/src/__tests__/DashboardStartBox.test.tsx`;
  - edit `DashboardView.test.tsx`;
  - core content tests (`faq.util.test.ts`, `glossary.util.test.ts`, `help-findability.test.ts`) stay green.

**Steps**

1. **Tests (spec, web: `DashboardStartBox` about 4, `DashboardView` about 2).**
   - The box preselects the launcher's station.
   - A picked station survives the recent portals reloading.
   - Search queries `stations.list` with the debounced term.
   - Axe passes.
   - The dashboard has no Open Portal button or dialog, and the start box renders in the start slot.

   Run them; they fail.
2. **Implement** the container and the view change. Green. Then update the four doc surfaces and run the core content suites.
3. Run lint and type-check. Confirm that the `dialog-contract` and `mutation-invalidate` guards still pass now the dashboard's dialog is gone.

**Done when:** the slice's cases and every touched suite pass. In the dev stack, typing a question on the dashboard lands in a portal that answers it. That's the smoke's headline step, walked later.

**Risk:**
- **Workbench test fixtures:** `DashboardWorkbench.test.tsx` builds `StartBoxUI` with the old `onStart` shape and needs its literal updated (`noop` already fits).
- **Header's Open Portal:** removing the dashboard's own Open Portal leaves the header's as the page's only one. The e2e core loop clicks the station page's button, so it's unaffected.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | message limit, create/start/outcome schemas, `Composer` `error` | core unit; api and web type-check |
| 2 | create-with-message, shared refusal, OpenAPI | api unit and integration (`portal.router`, `agent-turn-gate`) |
| 3 | resume on open, refused draft, `setDraft` | web `PortalSession`, `ChatWindowUI` |
| 4 | picker search, start box validation, launcher `startBox` | web `StationPicker`, `StartBox`, launcher |
| 5 | `DashboardStartBox`, dashboard create path removed, docs | web `DashboardStartBox`, `DashboardView`; core content |

## Cross-slice notes

- **Core rebuild.** After slices 1 and 5, rebuild core (`npm run build --workspace @portalai/core`) before the api and web runs. The API dev server keeps stale core until it restarts. Core's NodeNext build needs `.js` on relative imports.
- **E2E spec.** `packages/e2e/src/specs/core-loop.spec.ts:115` clicks "Open Portal" inside `main` on the **station** page, not the dashboard, so slice 5 doesn't affect it.
- **Accessibility report.** A new interactive pattern (a form on the dashboard, a searchable picker) is an ACR re-check: in slice 5, confirm `docs/ACCESSIBILITY_CONFORMANCE_REPORT.md` needs no row change, and update its report date if it does.
- **Invalidation.** It's unchanged: the launcher's create already invalidates `portals.root` through its `invalidate` option.
- **Turn limit.** The local standard tier allows 9 agent turns a day per org. Smoke walks that create-with-message spend them.

## Next step

Implementation starts on this branch once the plan is confirmed: slice 1, tests first, one commit per slice.
