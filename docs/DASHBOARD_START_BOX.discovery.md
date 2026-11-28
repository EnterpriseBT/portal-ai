# Dashboard start box — Discovery

**Issue:** [EnterpriseBT/portal-ai#1079](https://github.com/EnterpriseBT/portal-ai/issues/1079) · Feature · **full**. Child of the Dashboard redesign epic (#1085); branch `feat/1079-dashboard-start-box` → `epic/dashboard-redesign`.

**Why this exists.** Starting a portal today takes four steps: open a dialog, pick a station, land on an empty portal, type. #1123 built a start box (one line to type into, a station chip, Start), and #1078 left the workbench's `start` slot waiting for it. This ticket wires it so a question typed on the dashboard lands the user in a new portal that already holds that question and is already answering it.

That needs one thing the system can't do yet: create a portal *with* its first message. This is the change that adds an optional initial message to portal creation (core contract, API route, web SDK), and the dashboard wiring that uses it.

## The current shape

### Creating a portal

| Piece | Location | Note |
|---|---|---|
| Body | `packages/core/src/contracts/portal.contract.ts:113` `CreatePortalBodySchema` | `{ stationId }`, `.strict()` (an unknown key is a 400 naming it, #745) |
| Response | `portal.contract.ts:121` `PortalCreateResponsePayloadSchema` | `{ portal }` |
| Route | `apps/api/src/routes/portal.router.ts:98-178` `POST /api/portals` | parse → `invalidPayload(PORTAL_INVALID_PAYLOAD)` (`:103-112`); station in org and readable, else 404 `STATION_NOT_FOUND` (`:119-133`); `resource.write` on the portal (`:134`); `PortalService.createPortal` (`apps/api/src/services/portal.service.ts:663`), which refuses a station with no tools (`PORTAL_STATION_NO_TOOLS`) and names the portal "Portal — <date>"; 201 |
| Authorization map | `apps/api/src/__tests__/config/route-authorization.map.ts:854-858` | `POST /api/portals` |
| OpenAPI | `portal.router.ts:37-97` | 201 refs `#/components/schemas/Portal` (`apps/api/src/config/swagger.config.ts:2110`) |

### Sending a message, and what runs the turn

It's **two requests**, and the turn runs in the second:

1. `POST /api/portals/:id/messages` (`portal.router.ts:771-854`) checks write access and the station's readability, then `AgentTurnCeilingService.checkAdmission(organizationId)` (`:822`). A denial is a `429 AGENT_TURN_LIMITED` with `Retry-After`, before anything is written. On admission it stores the user row (`PortalService.addMessage`, `portal.service.ts:790`) and answers `{ status: "streaming" }`.
2. `GET /api/sse/portals/:portalId/stream` (`apps/api/src/routes/portal-events.router.ts:90-236`) reads the newest message:
   - **An assistant row:** it replays it (`:115-120`).
   - **A pending user row:** it takes the Redis turn lock (`apps/api/src/services/portal-turn-guard.service.ts:54`, 180s TTL), so a concurrent connection waits and replays, then runs `PortalService.streamResponse` (`portal.service.ts:1027`).

**So a user row with no stream client waiting is never answered.** The other per-message gates:
- **Rate limit:** the per-user API bucket (`apps/api/src/routes/protected.router.ts:64-69`).
- **Turn ceiling:** per org, per minute and per day by tier. It fails open (`apps/api/src/services/agent-turn-ceiling.service.ts:39-90`).
- **Cost gate:** charged per tool call inside the turn (`apps/api/src/services/cost-gate.service.ts`), never per message.

**There is no message length limit anywhere.** `SendMessageBodySchema` is `message: z.string().min(1)` (`portal.contract.ts:133-137`), and the chat composer sets no maximum. `POST /:id/messages` has no `@openapi` block.

### Web

| Piece | Location | Note |
|---|---|---|
| SDK | `apps/web/src/api/portals.api.ts:41-57` | `create`, `sendMessage` |
| Portal page | `apps/web/src/views/Portal.view.tsx:38`, `:203` | loads the portal, renders `PortalSession` |
| Sending | `apps/web/src/components/PortalSession.component.tsx:545-582` `handleSubmit` | trim → optimistic row → `sendMessage` → on `AGENT_TURN_LIMITED` an inline `turnLimitNotice` (`:70`, `:164`), else a toast → `streamActions.send(portalId)` opens the EventSource (`apps/web/src/utils/portal-stream.util.ts:167-175`) |
| Resuming | `PortalSession.component.tsx:581` | `send` is called **only** from `handleSubmit`. A page that loads with a pending user row shows it and never opens the stream |
| Launcher | `apps/web/src/utils/use-portal-launcher.util.ts:96-181` | `gate = useCreateGate("portal", "Ask for access to start portals")` (`:131`); `start(body, fromChooser)` (`:139`) creates and navigates to `/portals/:id` (`:148`); shared by the header's `NewPortalButton` and the command palette |
| Dashboard | `apps/web/src/views/Dashboard.view.tsx` | its own create mutation plus `CreatePortalDialog` behind Open Portal; the workbench `start` slot is empty |
| Start box UI | `apps/web/src/components/StartBox.component.tsx` (#1123) | `stations`, `initialStationId`, `gate`, `pending`, `serverError`, `onStart({ prompt, stationId })` |
| Duplicate submits | `apps/web/src/utils/api.util.ts:650-666` | `useAuthMutation` drops an identical in-flight request (#751); the server has no create idempotency |

### Docs that describe starting a portal

`apps/web/src/utils/getting-started.util.ts:47` ("Press Open Portal…"), `packages/core/src/content/faq.util.ts:72,79`, `glossary.util.ts:372` (Portal), `troubleshooting.util.ts:121-132` (turn limit).

## The design space

### Decision 1 — How the first message rides on create

- **A. `initialMessage` on the create body.** The route admits the turn against the ceiling, then creates the portal and stores the user row in one transaction. The client then opens the portal, whose stream runs the turn as for any message.
- **B. Client chains create, then `sendMessage`.** No contract change, but two writes the client sequences. A tab closed between them leaves an empty portal, and the ticket asks for the capability on create.
- **C. The create route also runs the turn.** It starts the agent server-side, detached from any stream. Today the turn lives inside the stream request, so this rebuilds streaming for one caller.

| | A | B | C |
|---|---|---|---|
| Matches the ticket's "capability on create" | yes | no | yes |
| One server write for portal + message | yes | no | yes |
| Streaming architecture | unchanged | unchanged | rebuilt |
| Same gates as any message | yes (same ceiling check) | yes | needs rewiring |

**Lean: A.** It's the smallest change that makes "portal plus first message" one server act, and every gate stays where it already is.

### Decision 2 — When the ceiling refuses the first message

The ticket wants the refusal shown **and** the portal kept, so nothing typed is lost.

- **A. Refuse the whole create (429, no portal).** The start box keeps the prompt inline. Simple, but it contradicts "the portal still exists".
- **B. Create the portal, don't store the message, and report the refusal in the 201:** `initialMessage: { status: "refused", code, message, retryAfterSeconds }`. The web lands in the portal with the prompt in its composer as an unsent draft and the existing turn-limit notice showing.
- **C. Store the message anyway and let the stream refuse it.** The stream route isn't gated (by design), so this would bypass the ceiling.

**Lean: B.** It's the only option that honours both halves of the acceptance criterion, and it reuses the portal page's own turn-limit notice.

### Decision 3 — Who opens the stream for the first message

- **A. The portal page resumes a pending turn on mount.** `PortalSession` opens the stream when the newest message is a pending user row. It's safe to repeat, because the stream route replays a finished turn and locks a running one (#504). It also fixes today's gap where a reload between POST and stream leaves a question unanswered.
- **B. The start box opens the stream before navigating.** That ties the turn to a component that unmounts on navigation.

**Lean: A.** It's one rule ("a pending turn gets answered when its portal is open"), and the server already makes it idempotent.

### Decision 4 — The message length limit

There is none today, so the ticket's "follows the portal message limit" has to create one.

- **A. A shared core field, used by both `initialMessage` and `SendMessageBodySchema.message`.** Trimmed, non-empty, max `PORTAL_MESSAGE_MAX_LENGTH`, composed like `nameField` (#801).
- **B. Limit only `initialMessage`.** The two paths would disagree.

**Lean: A, at 20,000 characters.** That's generous for a pasted table or a long question, bounded for the model and the row. Adding a max to `sendMessage` is a contract tightening, so a 400 now names the field where a huge paste used to be accepted.

### Decision 5 — Web wiring

- **A. The start box goes through the launcher.** Extend `usePortalLauncher`'s `start` to carry `initialMessage`, show errors inline (as the chooser dialog does), and keep its gate and pending state. The dashboard drops its own create mutation and `CreatePortalDialog` with the Open Portal button.
- **B. The dashboard keeps its own create mutation.** That's a second create path to keep in step with the header and the palette.

**Lean: A.** One create path for every launcher surface. The station preselection is the first Recent portals row's `stationId`, decided on #1079.

## Tradeoff comparison

| | D1: create carries it | D2: 201 + refused | D3: resume on mount | D4: shared 20k field | D5: via launcher |
|---|---|---|---|---|---|
| Contract change | yes (optional field + response) | yes (response field) | no | yes (send gets a max) | no |
| Spreads to the spec | yes | yes | yes | yes | yes |

## Recommendation

1. Add `initialMessage?: portalMessageField` to `CreatePortalBodySchema` (still `.strict()`), and export a required-message variant (`StartPortalBodySchema`) for the start box's validation.
2. In `POST /api/portals`, when `initialMessage` is present, check `AgentTurnCeilingService.checkAdmission` after the station and permission checks.
   - **Admitted:** create the portal and its user row in one transaction.
   - **Refused:** create the portal alone and return `initialMessage: { status: "refused", code: "AGENT_TURN_LIMITED", message, retryAfterSeconds }`.
   - **Admitted case:** the 201 carries `initialMessage: { status: "pending" }`.
3. Add `PORTAL_MESSAGE_MAX_LENGTH = 20_000` and a `portalMessageField` (trimmed, non-whitespace, max) in core, used by `initialMessage` and `SendMessageBodySchema.message`. A too-long or blank value is a `400 PORTAL_INVALID_PAYLOAD` naming the field.
4. Update the create route's `@openapi` block and its swagger component, and add the missing `@openapi` block for `POST /:id/messages`.
5. `PortalSession` opens the stream on mount when the newest message is a pending user row.
6. On a refused first message, the portal page seeds the composer with the unsent prompt and shows the existing turn-limit notice.
7. `usePortalLauncher.start` takes `initialMessage`, and the dashboard's start box uses it with errors shown inline in its `FormAlert`.
   - **Start box state:** the box validates with `validateWithSchema(StartPortalBodySchema, …)`, keeps touched/errors and calls `focusFirstInvalidField`.
   - **Preselection:** the first Recent portals row's station.
   - **Removed:** the dashboard's Open Portal button, its create mutation and its `CreatePortalDialog`. The header's launcher still offers the dialog.
8. Update Getting Started, the FAQ and the glossary to say a portal starts from the dashboard's box, and the turn-limit troubleshooting entry to cover a refused first question.

## Open questions

1. **Does `PortalCreateResponsePayload` grow an `initialMessage` field, or does the 201 stay `{ portal }` and the client infer from the messages?** An explicit field makes the refusal readable without a second request. Lean: add the field, optional, absent when no message was sent.
2. **Should a refused first message still count toward the per-minute rate limit?** It does today for `sendMessage`, since the API rate limiter runs before the route. Lean: yes, unchanged, since it's the same request budget.
3. **Where does the composer's draft for a refused message live across reloads?** Lean: navigation state only (the 201's refusal is passed to the portal page). A reload drops it, and the notice says to retry. Per-portal draft persistence is a separate feature.
4. **Is 20,000 the right ceiling?** Lean: yes for now, as one named constant so it's a one-line change. Pastes past it are better as an upload.

## Enterprise-scale considerations

- **Concurrency & correctness.** Lean: the portal and its first message commit in one transaction, so there's never a portal with a half-written first turn. A double submit is dropped client-side (#751). The server has no create idempotency, as today: a raced double create makes two portals, each with its message. That's prototype-grade acceptable because creates are user-paced and the per-turn lock stops a double answer. Resume-on-mount is idempotent through the #504 lock and replay.
- **Accuracy & auditability.** N/A because the portal and message rows are the record. No counter or ledger is added, and the turn ceiling's accounting is unchanged.
- **Failure modes.** Lean: the ceiling fails open as today, a refusal is reported in the 201 rather than lost, and a stream that drops is resumed the next time the portal opens. Nothing new fails closed.
- **Scale & unbounded growth.** Lean: the new message max bounds request and row size on both paths. Turns stay bounded by the tier ceiling and `stepCountIs(10)`.
- **Multi-tenancy.** Lean: unchanged. The station's org and readability check, the per-org ceiling and the per-user rate limit all apply before any write.
- **Contract stability.** Lean: `initialMessage` is optional and the schema stays strict, so existing callers (`CreatePortalDialog`, the launcher, the palette) are untouched. The response field is additive.
- **Data lifecycle.** N/A because no retention or windows change. The turn ceiling keeps its existing windows.

## What this doesn't decide

- Attachments or uploads from the start box (out of scope in the ticket).
- Server-side create idempotency keys: not needed at user pace, and a separate hardening ticket if it ever is.
- Persisting composer drafts per portal: a feature of its own.
- The header split button and palette UI (Launcher epic). They only gain the optional field.

## Next step

`/spec 1079` turns the recommendation into the contract: the core schemas and constant, the route's behaviour and responses, the resume rule, and the acceptance tests. Then `/plan 1079` slices it test-first, probably in this order:

1. The core contract and length limit.
2. The API create-with-message, with the integration tests for admission, refusal and limits.
3. Resume on mount and the refused-draft handling in `PortalSession`.
4. The launcher's `initialMessage` and the dashboard start box.
5. Docs.
