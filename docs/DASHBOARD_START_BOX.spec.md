# Dashboard start box — Spec

**Issue:** [EnterpriseBT/portal-ai#1079](https://github.com/EnterpriseBT/portal-ai/issues/1079) · **Epic:** #1085 · **Discovery:** `docs/DASHBOARD_START_BOX.discovery.md`

This pins the contract for creating a portal with its first message (core, API, SDK), the portal page resuming a pending turn, one length limit for every portal message, and the dashboard start box wired through the shared launcher.

## Key decisions (flag for review)

1. **D1: the first message rides on create.** `CreatePortalBodySchema` gains an optional `initialMessage`. When it's admitted, the portal and its user row commit in one transaction, and the portal page's stream runs the turn like any other.
2. **D2: a refusal still creates the portal.** If the turn ceiling refuses the first message, the portal is created without it and the 201 says `initialMessage: { status: "refused", … }`. The portal page seeds its composer with the prompt and shows the existing turn-limit notice.
3. **D3: the new portal's first question is answered on open.** The launcher opens an admitted create with history state `{ pendingInitialMessage: true }`. `PortalSession` opens the stream once on load only with that state, when the newest message is a user row and the caller can write. The server's #504 lock and replay make this safe to repeat. *Narrowed in the code review (#1137):* resuming any newest user row would re-run an older failed turn on every visit, unadmitted, since a failed turn stores no reply and the stream route doesn't check the ceiling. *Extended in the adversarial walk (#1137):* an admitted question whose portal never opened (Back pressed while the create was in flight) is also answered, on the first visit after, in the same tab: the launcher marks the portal in session storage from the create's promise, and the page forgets the mark when it reads it, so it still resumes at most once. The start box also holds Start from a start until it unmounts or fails, since the dashboard stays on screen until the new portal's page loads.
4. **D4: one length limit, 20,000 characters.** `portalMessageField` is used by `initialMessage` and by `SendMessageBodySchema.message`. That tightens `POST /:id/messages`: a message past the limit, or blank after trimming, is now a 400 naming the field.
5. **D5: the launcher owns every create.** The start box goes through `usePortalLauncher` (shared via `PortalLauncherContext`). The dashboard's own create mutation, `CreatePortalDialog` and Open Portal button go. The header launcher keeps the dialog.
6. **Discovery's open questions, as resolved on commit:**
   - the 201 carries an explicit, optional `initialMessage` outcome;
   - a refused first message still counts against the rate limit and the ceiling window (as any denied send does today);
   - the refused prompt lives in router history state only, so a reload drops it;
   - the limit is one named constant.
7. **Preselection.** The chip preselects `launcher.station`. On the dashboard that's the most recent portal's station, or failing that the first favorite, the same rule the header uses.
8. **Enterprise leans carried forward.**
   - Portal and first message are written atomically (`DbService.transaction`).
   - The ceiling fails open, as today.
   - There's no server create idempotency (prototype-grade acceptable: creates are user-paced, `useAuthMutation` drops a double submit, and the turn lock stops a double answer).

## Scope

### In scope
- Core: `PORTAL_MESSAGE_MAX_LENGTH`, `portalMessageField`, the create body, `StartPortalBodySchema`, the response outcome, and the tightened send body.
- API: the create route admits and writes the first message, a shared refusal message, and the OpenAPI for create and for `POST /:id/messages`.
- Web:
  - the SDK type;
  - the launcher's start-box path;
  - `PortalSession` resume and the refused draft;
  - `ChatWindowHandle.setDraft`;
  - `Composer` error display;
  - `StationPicker` search;
  - the start box's validation;
  - the dashboard wiring, with its create path removed.
- Docs: Getting Started, the FAQ, the glossary, and the turn-limit troubleshooting entry.

### Out of scope
- Attachments from the start box.
- Server create idempotency keys.
- Per-portal drafts that survive a reload.
- The header split button (Launcher epic).
- Any change to the cost gate. It still charges per tool call inside the turn, and the first message reaches it like any other turn.

## Surface

### Core — `packages/core/src/contracts/text-limits.contract.ts`

```ts
/** A portal message (#1079): a pasted table or a long question, bounded for
 *  the model and the row. */
export const PORTAL_MESSAGE_MAX_LENGTH = 20_000;

/** Trimmed, required, at most `PORTAL_MESSAGE_MAX_LENGTH`. */
export const portalMessageField = (field = "Message") =>
  z.string().trim()
    .min(1, `${field} is required`)
    .max(PORTAL_MESSAGE_MAX_LENGTH, tooLongMessage(field, PORTAL_MESSAGE_MAX_LENGTH));
```

### Core — `packages/core/src/contracts/portal.contract.ts`

```ts
export const CreatePortalBodySchema = z.object({
  stationId: z.string().min(1),
  initialMessage: portalMessageField("Initial message").optional(),
}).strict();

/** The start box's form (#1079): the same fields, both required. */
export const StartPortalBodySchema = z.object({
  stationId: z.string().min(1, "Pick a station"),
  initialMessage: portalMessageField("Question"),
}).strict();
export type StartPortalBody = z.infer<typeof StartPortalBodySchema>;

export const InitialMessageOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({
    status: z.literal("refused"),
    code: z.literal("AGENT_TURN_LIMITED"),
    message: z.string(),
    retryAfterSeconds: z.number().int().nonnegative(),
  }),
]);
export type InitialMessageOutcome = z.infer<typeof InitialMessageOutcomeSchema>;

export const PortalCreateResponsePayloadSchema = z.object({
  portal: PortalSchema,
  /** Present only when the body carried `initialMessage`. */
  initialMessage: InitialMessageOutcomeSchema.optional(),
});

export const SendMessageBodySchema = z.object({
  message: portalMessageField("Message"),
}).strict();
```

`name-length.guard.test.ts` already requires a max on request-body text fields. `initialMessage` and `message` satisfy it through `portalMessageField`.

### API — `AgentTurnCeilingService` (`apps/api/src/services/agent-turn-ceiling.service.ts`)

```ts
/** The user-facing refusal for a denied admission, shared by the send and
 *  create routes so both read the same. */
static refusalMessage(denial: Extract<TurnAdmission, { allowed: false }>): string;
```

It returns the two strings currently inline at `portal.router.ts:828-830` (the day window, then the minute window). The send route switches to it, with no change in behaviour.

### API — `PortalService.createPortal` (`apps/api/src/services/portal.service.ts:663`)

```ts
static async createPortal(args: {
  stationId: string; organizationId: string; userId: string;
  /** Trimmed by the contract. */
  initialMessage?: string;
}): Promise<CreatePortalResult>;

export interface CreatePortalResult {
  portalId: string;
  stationContext: StationContext;
  initialMessage?: InitialMessageOutcome;   // set iff args.initialMessage
}
```

The order inside `createPortal` is fixed so that a refused or invalid request never consumes a turn:

1. Validate the station and its tool packs, as today (`STATION_NOT_FOUND`, `PORTAL_STATION_NO_TOOLS`).
2. If `initialMessage` is set, call `AgentTurnCeilingService.checkAdmission(organizationId)`.
3. In one `DbService.transaction(tx => …)`:
   - insert the portal (`repo.portals.create(row, tx)`);
   - if admitted, insert the user row (`repo.portalMessages.create({ role: "user", blocks: [{ type: "text", content }], createdBy: userId, … }, tx)`), the same row shape `addMessage` writes.
4. Return `initialMessage`:
   - `{ status: "pending" }` when admitted;
   - `{ status: "refused", code: "AGENT_TURN_LIMITED", message: refusalMessage(denial), retryAfterSeconds }` when refused.

A failed transaction leaves neither row behind. A turn the ceiling admitted stays counted (it counts attempts, as `sendMessage` does today).

### API — `POST /api/portals` (`apps/api/src/routes/portal.router.ts:98`)

- The parse, station check and `resource.write` check are unchanged, and all run before `createPortal`.
- It passes `initialMessage` through.
- It answers `201 { portal: { id }, portalId, stationContext, initialMessage? }`.
- A refused first message is still a 201, with no `Retry-After` header, since the create succeeded.
- A blank or over-long `initialMessage` is `400 PORTAL_INVALID_PAYLOAD`, with "Initial message is required" or "Initial message must be 20000 characters or fewer" in the message.
- A body without `initialMessage` behaves byte-for-byte as today.
- `route-authorization.map.ts:854` keeps its entry (no new route).

### API — `POST /api/portals/:id/messages` (`portal.router.ts:771`)

- Its message now comes from `portalMessageField`, so a blank or over-long message is `400 PORTAL_INVALID_PAYLOAD` naming "Message".
- The refusal text comes from `refusalMessage`.
- Its `@openapi` block (which sits above the PATCH route's comment, not over the handler) references `SendMessageBody` and gains the 429 (with `Retry-After`) it was missing.

### API — OpenAPI (`apps/api/src/config/swagger.config.ts`)

- Register `CreatePortalBody`, `InitialMessageOutcome` and `SendMessageBody` via `z.toJSONSchema`.
- The create block (`portal.router.ts:37-97`) references `CreatePortalBody` for its request, and its 201's `initialMessage` references `InitialMessageOutcome`. `PortalCreateResponsePayloadSchema` isn't registered: it types `portal` as a full `Portal`, while the route sends `{ id }` beside `portalId` and `stationContext`. The 201 now documents `portal` as `{ id }`.

### Web — SDK (`apps/web/src/api/portals.api.ts:41`)

`create` keeps `useAuthMutation<PortalCreateResponsePayload, CreatePortalBody>`. Only the core types change.

### Web — launcher (`apps/web/src/utils/use-portal-launcher.util.ts`)

`PortalLauncher` gains:

```ts
startBox: {
  /** Starts a portal with its first question. Errors show in the box. */
  onStart: (body: StartPortalBody) => void;
  /** The last start-box create's error, else null. */
  serverError: ServerError | null;
};
```

- `start` records which surface submitted it (`"launch" | "chooser" | "startBox"`).
  - **Toast:** only `launch` raises one.
  - **`chooser.serverError`:** set only for the chooser's submit, as today.
  - **`startBox.serverError`:** set only for a start-box submit.
- **Admitted** (`initialMessage` pending): navigates to `/portals/:id` with history state `{ pendingInitialMessage: true }`. Absent (no first message): navigates plainly.
- **Refused:** navigates with history state `{ refusedInitialMessage: { prompt, message } }`.
- One `create` mutation still serves every surface, so a double submit across them sends once.
- `pending` and `gate` are unchanged.

### Web — history state (`apps/web/src/utils/portal-initial-message.util.ts`, new)

- Augments `@tanstack/react-router`'s `HistoryState` with `refusedInitialMessage?: { prompt: string; message: string }`.
- Exports `readRefusedInitialMessage(state): { prompt; message } | null`, which validates the shape and returns null on anything else.

### Web — `ChatWindowHandle` (`apps/web/src/components/ChatWindow.component.tsx:32`)

Adds `setDraft: (text: string) => void`. It sets the composer's value and moves focus to the end of it.

### Web — `PortalSession` (`apps/web/src/components/PortalSession.component.tsx:367`)

**Resume.** Only when the page opened with `pendingInitialMessage` history state, or this tab's session storage marks the portal (`portalai-pending-first-turns`, written from the create's promise, dropped after 24 hours). Both are read once at mount, then cleared. Once the first `portalQuery` success has loaded for a `portalId`, the session checks three things:
- the newest server message has `role === "user"`;
- the caller has `capabilities.write`;
- no stream is running.

When all hold, it calls `streamActions.send(portalId)` once, with a ref guard keyed by `portalId`, and sets `streamStartedAt`. A reader never resumes, because the server would only replay for them.

**Refused draft.** On mount, if `readRefusedInitialMessage(location.state)` returns a value:
- it calls `chatRef.current?.setDraft(prompt)`;
- it calls `setTurnLimitNotice({ message, showUpgrade })`;
- it replaces the history entry without that state, so Back and Forward don't re-seed it.

The notice clears on the next successful send, as today.

### Web — `Composer` (`packages/core/src/ui/Composer.tsx`)

`ComposerProps` gains `error?: string | null`. When it's set:
- the textarea gets `aria-invalid="true"`;
- the error text renders in `error` colour under the field;
- the textarea's `aria-describedby` references the error alongside the existing hidden description.

It never sets a `maxLength`.

It also gains `onBlur?: React.FocusEventHandler<HTMLTextAreaElement>` (added in slice 4), so the start box can mark the prompt touched.

### Web — `StationPicker` (`apps/web/src/components/StationPicker.component.tsx`)

`StationPickerUIProps` gains:

```ts
search?: { query: string; onQueryChange: (q: string) => void;
           results: StationOption[]; searching: boolean };
```

With `search`, the menu opens with a "Search stations" field.
- **Empty query:** shows `stations` (favorites first, as today).
- **Typed query:** shows `results`, with "Searching…" while `searching` and "No stations match" when there are none.

Without `search` it renders exactly as today, so its stories and tests still pass. `StartBoxUI` passes `search` through. The selected station's name comes from `stations` or `results`, and the box keeps a picked station's option, so a picked station stays named after the query changes.

### Web — `StartBoxUI` (`apps/web/src/components/StartBox.component.tsx`)

- `onStart` becomes `(body: StartPortalBody) => void`.
- It adds the `stationSearch?` prop and passes it to the picker.
- **Validation.** On submit it validates `{ stationId, initialMessage: prompt }` with `validateWithSchema(StartPortalBodySchema, …)` and marks both fields touched. If invalid, it shows the errors (Composer `error` for `initialMessage`) and calls `focusFirstInvalidField()`. It never calls `onStart` with invalid data.
- **Touched.** The prompt is marked touched on a plain `onBlur` (the box isn't a dialog, so `blurUnlessDialogControl` doesn't apply).
- **Gates.** Start's existing disable gates (no station, blank prompt) stay. The submit-time validation is what catches a prompt over the limit.
- **Server errors.** A `serverError` renders in `FormAlert` and keeps the typed prompt.

### Web — Dashboard (`apps/web/src/views/Dashboard.view.tsx`)

- **`DashboardViewUI`:** drops `onNewPortal` and the `headerAction` Open Portal button, and adds a `startBox: React.ReactNode` slot passed to the workbench's `start`.
- **Container:** removes `createMutation`, `createOpen`, `CreatePortalDialog` and `handleCreateSubmit`. It renders `<DashboardStartBox />`.
- **`DashboardStartBox` (new, `components/DashboardStartBox.component.tsx`):** a container with no UI pair of its own, which wraps `StartBoxUI`. It reads `usePortalLauncherContext()` and passes the box's props:

  | `StartBoxUI` prop | Value |
  |---|---|
  | `stations` | Up to 5 suggestions (`utils/start-box-stations.util.ts`, added before smoke at the user's request): the stations of the caller's latest portals (`portals.list` `mine`, `lastOpened` desc, `include=station`), then favorites, then the newest stations (`stations.list` `created` desc), each once, grouped under "Recent stations", "Favorite stations" and "More stations"; plus `launcher.station` when it isn't among them, in its group. The picker's search is core `Combobox`, which renders the group headings; search results are ungrouped |
  | `initialStationId` | `launcher.station?.id ?? null` |
  | `gate` | `launcher.gate` |
  | `pending` | `launcher.pending` |
  | `serverError` | `launcher.startBox.serverError` |
  | `onStart` | `launcher.startBox.onStart` |
  | `stationSearch` | `sdk.stations.list({ search, limit: 10, offset: 0, sortBy: "name", sortOrder: "asc" })`, enabled for a non-empty query debounced through `use-debounced-value.util.ts` |

  Station reads are org- and visibility-filtered by the API, so an unreadable station is never offered.

### Docs

| File | Change |
|---|---|
| `apps/web/src/utils/getting-started.util.ts:47` | "Type a question in the dashboard's start box…" in place of "Press Open Portal…" |
| `packages/core/src/content/faq.util.ts:72,79` | Starting a portal from the dashboard. The header's Open Portal still opens the chooser |
| `packages/core/src/content/glossary.util.ts:372` | Portal: "start one from the dashboard with your first question" |
| `packages/core/src/content/troubleshooting.util.ts:121-132` | A refused first question: the portal is created, the question waits in its box, send it when the limit resets |

## Migration
## Seed

None. No schema change and no seeded rows.

## TDD test plan

Run per package with `npm run test:unit` / `npm run test:integration`, never raw jest.

### Core: `packages/core/src/__tests__/contracts/`
- **`text-limits.contract.test.ts`:** `portalMessageField` trims, rejects blank and whitespace-only values, accepts exactly 20,000, and rejects 20,001 with the field's message.
- **`portal.contract.test.ts`:**
  - create without `initialMessage` parses as today;
  - create with it parses trimmed;
  - an unknown key is rejected;
  - `StartPortalBodySchema` requires both fields with "Pick a station" / "Question is required";
  - both arms of `InitialMessageOutcomeSchema` parse;
  - send rejects 20,001 characters.

  About 10 cases.
- **`Composer.test.tsx`** (core ui): `error` sets `aria-invalid` and describes the field; there's no `maxLength`; axe passes with the error showing. About 3 cases.

### API

**`apps/api/src/__tests__/__integration__/routes/portal.router.integration.test.ts`.** About 7 cases:
- create with `initialMessage` → 201 `{ status: "pending" }`, with the portal holding one user row of the trimmed text;
- create without it → 201 with no `initialMessage` and zero messages;
- 20,001 characters, or whitespace → 400 `PORTAL_INVALID_PAYLOAD` naming "Initial message", with no portal created;
- a station with no tools → 400, and the ceiling window is unchanged (admission runs after validation);
- an unreadable station → 404, with no portal;
- send with 20,001 characters → 400 naming "Message".

**`agent-turn-gate.integration.test.ts`** (tier `agentTurnsPerMin: 1`). About 3 cases:
- the first create-with-message is admitted;
- a second → 201 with `status: "refused"`, `code: "AGENT_TURN_LIMITED"`, `retryAfterSeconds > 0` and a portal with zero messages;
- the refusal text equals the send route's.

**`apps/api/src/__tests__/services/agent-turn-ceiling.service.test.ts`.** `refusalMessage` gives the day and minute strings. 2 cases.

**Transaction.** A forced failure of the message insert leaves no portal row. 1 case, in `portal.router.integration.test.ts`, by stubbing `portalMessages.create` to throw.

### Web: `apps/web/src/__tests__/`

**`use-portal-launcher.start-box.test.tsx`** (new; `use-portal-launcher.util.test.ts` covers only the pure helpers and mocks nothing). About 5 cases:
- `startBox.onStart` posts `{ stationId, initialMessage }`;
- pending navigates to `/portals/:id` with `pendingInitialMessage` state;
- refused navigates with `refusedInitialMessage`;
- a start-box failure sets `startBox.serverError` but not `chooser.serverError`, and raises no toast;
- a `launch` failure still toasts.

**`PortalSession.test.tsx`.** About 6 cases:
- a newest user row with write access resumes once (`send` called once, even after a refetch);
- an assistant-newest portal doesn't resume;
- a reader doesn't resume;
- a refused-state mount seeds the composer and shows the notice;
- the state is cleared from history;
- a successful send clears the notice.

**`ChatWindowUI.test.tsx`.** `setDraft` fills and focuses the field. 1 case.

**`StationPicker.test.tsx`.** About 4 cases:
- with `search`, typing calls `onQueryChange`;
- results replace the list;
- the "No stations match" and "Searching…" states;
- without `search` the menu is unchanged;
- axe on the open menu.

**`StartBox.test.tsx`.** About 6 cases:
- a valid submit calls `onStart` with a trimmed `StartPortalBody`;
- 20,001 characters shows "Question must be 20000 characters or fewer", sets `aria-invalid`, focuses the field and doesn't call `onStart`;
- the error appears only after blur or submit;
- `serverError` shows `FormAlert` and keeps the prompt;
- Enter submits and Shift+Enter adds a line (already covered; keep);
- axe with errors showing.

**`DashboardStartBox.test.tsx`** (new, container with a mocked SDK and launcher context). About 4 cases:
- preselects `launcher.station`;
- a picked station survives the recent portals reloading;
- search queries `stations.list` with the debounced term;
- axe.

**`DashboardView.test.tsx`.** About 2 cases:
- no Open Portal button and no Open Portal dialog on the page;
- the start box renders in the workbench's start slot.

**Docs content.** `faq.util.test.ts`, `glossary.util.test.ts` and `help-findability.test.ts` stay green. No new cases.

**Totals ≈ 54 cases.**

## Acceptance criteria

- [ ] Typing a question on the dashboard and pressing Enter lands the user in a new portal in the chosen station, with that question as its first message and the agent answering it.
- [ ] A portal the start box just created with an admitted question starts its answer on open, once. An older unanswered question (a failed turn) is not re-run when its portal is opened, and a reader of someone else's portal never starts one. *(Narrowed in the code review; see D3.)*
- [ ] With the org over its agent-turn limit, starting from the box still creates the portal and opens it with the question in its composer and the turn-limit notice showing.
- [ ] A blank question can't be started, and one over 20,000 characters shows a field error and isn't sent. The API refuses either with `400 PORTAL_INVALID_PAYLOAD` naming the field, on create and on send.
- [ ] Creating a portal without `initialMessage` behaves as today, so the header chooser, the palette and the station launchers are unchanged.
- [ ] The chip preselects the most recent portal's station. An empty search suggests up to five stations under "Recent stations", "Favorite stations" and "More stations"; typing searches every readable station. It never offers an unreadable station (`include=station` names only readable stations), and keeps a station the user picked. A favorite's star is the brand yellow.
- [ ] A create failure shows inline in the box and keeps the prompt. A caller who can't create portals sees Start's gate reason.
- [ ] The dashboard has no Open Portal button or dialog of its own. The header's Open Portal still opens the chooser.
- [ ] `POST /api/portals` and `POST /api/portals/:id/messages` are documented in Swagger with the new fields.
- [ ] Getting Started, the FAQ, the glossary and troubleshooting describe starting from the dashboard and a refused first question.
- [ ] Every new or changed component's test passes `expectNoAxeViolations`.

## Risks & rollback

- **Send-limit tightening.** A client that sent more than 20,000 characters now gets a 400. The web composer shows the server's message through the existing toast. **Detect:** `PORTAL_INVALID_PAYLOAD` on `/messages` in the logs. **Back out:** raise the constant.
- **Resume loops.** A resume that fires on every refetch would open a stream repeatedly. The ref guard is keyed by `portalId` and covered by a test, and the server replays rather than re-running an answered turn (#504).
- **Ceiling fails open**, as today. A Redis outage admits first messages too: an un-charged bound, with vendor caps as the backstop.
- **Rollback.** The PR reverts cleanly: no migration, and the contract additions are optional.

## Files touched

- **Core:**
  - `packages/core/src/contracts/text-limits.contract.ts`
  - `packages/core/src/contracts/portal.contract.ts`
  - `packages/core/src/ui/Composer.tsx`
  - `packages/core/src/content/{faq,glossary,troubleshooting}.util.ts`
  - tests
- **API:**
  - `apps/api/src/services/agent-turn-ceiling.service.ts`
  - `apps/api/src/services/portal.service.ts`
  - `apps/api/src/routes/portal.router.ts`
  - `apps/api/src/config/swagger.config.ts`
  - tests
- **Web:**
  - `apps/web/src/utils/use-portal-launcher.util.ts`
  - `apps/web/src/utils/portal-initial-message.util.ts` (new)
  - `apps/web/src/components/{ChatWindow,PortalSession,StationPicker,StartBox}.component.tsx`
  - `apps/web/src/components/DashboardStartBox.component.tsx` (new)
  - `apps/web/src/views/Dashboard.view.tsx`
  - `apps/web/src/utils/getting-started.util.ts`
  - stories for StationPicker, StartBox and the dashboard
  - tests

## Next step

`docs/DASHBOARD_START_BOX.plan.md` slices this into about five commits on this branch:

1. Core limit and contracts (with `Composer` `error`).
2. The API create-with-message, the shared refusal and the OpenAPI.
3. `PortalSession` resume and the refused draft (with `setDraft` and the history-state util).
4. `StationPicker` search, `StartBoxUI` validation and the launcher's start-box path.
5. The dashboard wiring, the removed create path, and docs.
