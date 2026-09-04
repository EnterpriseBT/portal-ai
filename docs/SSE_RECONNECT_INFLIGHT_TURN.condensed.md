# SSE reconnect re-fires the Anthropic call — Condensed design (#504)

**Issue:** [EnterpriseBT/portal-ai#504](https://github.com/EnterpriseBT/portal-ai/issues/504) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `GET /api/sse/portals/:portalId/stream` is stateless per connection: every `GET` rebuilds context and calls `streamText` once. An `EventSource` that drops mid-turn (laptop sleep, proxy idle-out, network blip) auto-reconnects **by design** — and `SseUtil` even ships `retry: 0` (`sse.util.ts:23`), so the browser reconnects immediately. The reconnect re-invokes `streamResponse` and fires a **duplicate Anthropic call** for the same turn (acknowledged in-code at `portal-events.router.ts:118`). It is a silent double-spend on the largest vendor line item, with no ledger trace (turns are un-charged). The #498 ceiling gates the *send* (the POST), not the reconnect, so the leak sits entirely outside it. The fix must be **server-side** — the client can't be trusted not to reconnect (that's EventSource), and this repo enforces gates on the server, not the client. Single-package (`apps/api`); no web change required.

## Current shape

| Piece | Location | Note |
|---|---|---|
| SSE `/stream` GET | `apps/api/src/routes/portal-events.router.ts:76-152` | Loads portal, rebuilds `stationContext`, calls `streamResponse`, then `sse.end()`. No in-flight/answered guard. |
| In-code acknowledgement | `portal-events.router.ts:118-121` | "close … so EventSource does not auto-reconnect and trigger duplicate Anthropic API calls" — the close is best-effort; a mid-stream drop reconnects anyway. |
| The model call | `apps/api/src/services/portal.service.ts:697` | `streamText(...)` — one per `GET`. Assistant row persisted at `:779`, `done` (carries `messageId`) at `:798`. |
| Turn history | `portal.service.ts:412-426` (`getPortal`) | Returns persisted `messages` rows + reconstructed `coreMessages`. Last row's role tells us pending (`user`) vs answered (`assistant`). |
| POST that writes the user row | `apps/api/src/routes/portal.router.ts:708-772` | #498 ceiling at `:737-750`; `addMessage` user row at `:752`. Returns `{status:"streaming"}`; frontend then opens the SSE. |
| Redis fixed-window + fail-open doctrine | `apps/api/src/utils/rate-limit.util.ts`, `redis-timeout.util.ts` (`withRedisTimeout`, `REDIS_OP_TIMEOUT_MS`) | Bounded, **rejects** on timeout; callers treat reject as fail-open. Reuse for the lock. |
| Sibling guard style + fail-open contract | `apps/api/src/services/agent-turn-ceiling.service.ts` | The shape to mirror for a small guard service. |
| Frontend stream consumer | `apps/web/src/utils/portal-stream.util.ts:133-256` | `done` handler renders from streamed blocks (`:207`); `onerror` gives up with "Connection lost" (`:245`). Reused unchanged by replay. |
| Advisory-lock precedent (not chosen) | `apps/api/src/services/sync-lock.service.ts:88` | Postgres **session-scoped** advisory lock — would pin a DB connection for the whole multi-minute stream; wrong tool here. |

## Decision — server-side idempotent turn guard, keyed on the pending user-message id, that **replays** rather than re-generates

On each `/stream` GET, before any model call, branch on the turn's state (turn key = the id of the last persisted **user** message):

1. **Already answered** (last persisted row is `assistant`): re-emit that message's blocks over SSE (`delta` for text, the display events for chart/table blocks) + `done`, then `end()`. **No model call.** This is the dominant reconnect case, because the orphaned original stream keeps running server-side and persists before the reconnect lands.
2. **In flight** (Redis turn lock held): the generating turn will persist momentarily. Bounded-poll the DB for the assistant row (a few `withRedisTimeout`-bounded ticks up to the lock TTL); on appearance, replay as in (1); on timeout, `sendError` ("still working — reopen the portal").
3. **Fresh** (pending user row, lock free): acquire the Redis turn lock (`SET key val PX <ttl> NX`, TTL ≈ max turn length ~3 min), run `streamResponse`, release in a `finally`.

Why replay and not deny: **today the duplicate call is what delivers the user's answer after a drop** — the original client connection is gone, so denying the reconnect outright would regress the user to a blank turn. Replaying the already-persisted assistant message fixes the cost leak *and* keeps the answer visible, reusing the frontend's existing `delta`/`tool_result`/`done` handlers with zero web change.

- **Mechanism:** Redis `SET … NX PX` (not Postgres advisory — that pins a pooled connection for minutes; not an in-process flag — ECS runs multiple instances and two reconnects can hit different ones). Lock lives in a small `PortalTurnGuardService` mirroring `AgentTurnCeilingService`.
- **Fail-open:** any Redis error/timeout → skip the guard and proceed to generate (today's behavior). An un-charged safety bound never blocks a turn on Redis health — same posture as the #498 ceiling and the cost gate.
- **Implementation care point:** persisted `blocks` are the render shape `getPortal` already returns; the replay emitter must map each block to the SSE event the frontend expects (text → `delta`; display block → the event `streamingBlockFor` reconstructs). Nail this against `portal-stream.util.ts` so a replayed turn renders identically to a live one.

## Plan — 2 slices

**Slice 1 — the guard + replay (server).**
- **Files (new):** `apps/api/src/services/portal-turn-guard.service.ts` — `acquireTurnLock`/`releaseTurnLock` (Redis `SET NX PX` via `withRedisTimeout`, fail-open) and `replayPersistedTurn(sse, messages)` (blocks → SSE events + `done`).
- **Files (edit):** `portal-events.router.ts:76-152` — branch answered / in-flight / fresh around the `streamResponse` call; `finally`-release the lock. `portal.service.ts` — expose the last-user-message id + persisted assistant blocks needed by the guard (small helper on `getPortal`'s result, or a focused finder).
- **Tests:** `apps/api/src/services/__tests__/portal-turn-guard.service.test.ts` — lock acquire/deny/release; fail-open on a stubbed Redis reject; replay emits the right SSE events in order for a text+chart persisted message. Run via `npm run test -- --testPathPattern portal-turn-guard`.

**Slice 2 — route-level idempotency test.**
- **Tests:** `apps/api/src/routes/__tests__/portal-events.router.test.ts` (extend/create) — a first `/stream` GET generates (one `streamText` mock call); a second concurrent GET for the same pending turn does **not** call `streamText` and instead emits the replayed `done`. Asserts the double-spend is closed at the route.
- No production code beyond wiring from Slice 1.

## Smoke (manual, against your dev stack)

**Confirmed passing — 2026-09-04** (Ben Turner), against the local dev stack. Agent evidence walk: `packages/e2e/test-results/smoke-walk-SSE_RECONNECT_INFLIGHT_TURN.md`. Decisive result: two concurrent `GET /stream` for one pending turn → **one** assistant row, **same `done` messageId** on both connections (one generated, one replayed); already-answered reconnect replays with no new row. Steps 1–4 verified (step 2's clean single-turn reconnect proven at the HTTP layer, since the app closes the EventSource on error); step 5 (Redis-down fail-open) covered by unit test, not walked live.

1. Start the dev stack (`npm run dev`) and open a portal in the app (`localhost:3000`). Send a message; confirm a normal streamed answer renders and one assistant message persists.
2. Send another message; **mid-stream, kill the network** (DevTools → Network → Offline for ~2s, then back online) to force an `EventSource` reconnect. Confirm: the answer still appears, exactly **one** assistant message is persisted for the turn, and the API log shows the reconnect took the **replay** path (no second `streamText`/Anthropic call).
3. Repeat step 2 but toggle offline **after** the answer finished rendering but before closing the portal (simulates the post-`done` reconnect race). Confirm no duplicate message and no second model call.
4. In-flight case: send a message and, while it is still streaming, open the **same portal in a second tab**. Confirm the second tab replays/attaches to the same turn rather than firing a fresh Anthropic call, and only one assistant message persists.
5. Redis-down degradation: stop local Redis, send a message. Confirm the turn still generates (fail-open) — a guard outage must never block a turn.

## Out of scope

- **Resumable streams** (buffer + `Last-Event-ID` mid-turn resume, ticket option b) — larger, no schema for a partial-turn buffer today; replay of the *completed* turn is sufficient to close the double-spend.
- **One-shot stream token minted by the POST** (ticket option c) — cleaner long-term contract but a web + API contract change; the server-side guard closes the leak without it.
- **Charging/ledgering turns** — turns remain un-charged (#498); this ticket removes the duplicate call, it does not introduce turn billing.
- **The `onerror` "Connection lost" UX** in `portal-stream.util.ts:245` — replay makes the reconnect succeed on its own; polishing the give-up copy is a separate cosmetic ticket.
