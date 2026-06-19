# Custom webhook compute scaling — Plan

Phased TDD slices for `docs/WEBHOOK_COMPUTE_SCALING.spec.md`. Each is one reviewable commit, green on its own. The security-sensitive read endpoint is isolated in its own slice with adversarial tests. **All slices assume #129 (#144) is on `main`** (see the spec's sequencing note) — rebase this branch onto `main` after #144 merges, then start slice 1.

## Slice 0 — Rebase onto the merged substrate
**Why first.** #124 consumes `getSnapshot` / `streamHandle` / `produce` / `QueryHandleEnvelope` from #129. Rebase `feat/webhook-compute-scaling` onto `main` once #144 lands; confirm the substrate symbols resolve. No new code — a clean base.

## Slice 1 — `produceFromRows` (the outbound producer primitive)
**Why early.** It's a self-contained extension of the existing producer with no transport — the foundation the outbound path needs, testable in isolation.
- Edit: `portal-sql-handle.service.ts` — extract the staging/envelope/Redis-batch path shared with `produce`; add `produceFromRows({ rows, schema?, stationId, organizationId })`. Cap staged rows at `HANDLE_ROW_CAP`; derive `schema` from the first row when omitted.
- Tests: spec unit 1 — supplied rows stage into the same envelope `produce` yields; `getSnapshot` reads them back; over-cap truncates with the `truncated` flag.
- **Done when:** a caller-supplied row set becomes a readable handle, identical envelope shape to `produce`.

## Slice 2 — Scoped read/write token service
**Why next.** The auth primitive both transport directions depend on; pure Redis + crypto, no routes yet.
- New: `webhook-read-token.service.ts` — `mint({org, handle, mode})` → opaque token (Redis `webhook-token:<token>` → `{org, handle, mode, exp}`, TTL = `min(WEBHOOK_READ_TOKEN_TTL_MS, handle-remaining)`); `validate(token, {handle, mode})` (fail-closed on miss/expire/scope); `revoke(token)`.
- Edit: `large-data-ops.constants.ts` (`WEBHOOK_READ_TOKEN_TTL_MS`); `api-codes.constants.ts` (the four codes).
- Tests: spec unit 2 — round-trip; wrong handle/org/mode/expired/revoked fail closed; read≠write scope.
- **Done when:** tokens are mint/validate/revoke correct and fail-closed.

## Slice 3 — Inbound `bounded`: records-in-body + gate-widen (`bounded`)
**The old #122, now within the taxonomy.** No new endpoint — server-resolved rows in the signed POST body.
- Edit: `tools.service.ts` `callWebhook` — when `consumption.mode === "bounded"`, `resolveRecordSource` (≤`maxRows`) and add `records` to the body; `onOverflow` honored.
- Edit: `toolpack-registration.service.ts` — `allowedConsumptionModes` += `"bounded"`.
- Tests: spec unit 3 + 6 (the `bounded` half) — POST carries `records` inside the signed body; over-bound → `onOverflow`; gate accepts `bounded`.
- **Done when:** a `bounded` custom tool receives server-resolved rows; registration accepts it.

## Slice 4 — The read endpoint + pull-on-read (`streaming`) — *security-isolated*
**The genuinely new trust-boundary surface; its own slice + adversarial tests.**
- New: `webhook-handle.router.ts` `GET /api/webhook/handle/:handleId?offset&limit` — token-authed (slice 2), serves a `getSnapshot` page (or `streamHandle` page for >`HANDLE_ROW_CAP`), `limit` clamped ≤ 5000, `@openapi` annotated.
- Edit: `callWebhook` — `consumption.mode === "streaming"` → mint a read token, POST the `source` grant (no `records`), **revoke on settle (success + error)**; `toolpack-registration` gate += `"streaming"`.
- Tests: spec unit 4 + integration 7 + 8 — token paging; another-org/expired/revoked/cross-handle/user-JWT-only all rejected; full round-trip with a mock webhook pulling every page; assert the user JWT never crosses.
- **Done when:** a `streaming` custom tool pulls a handle page-by-page through an adversarially-safe endpoint.

## Slice 5 — Outbound `{ resultHandle }` (staging write + envelope)
- New: `POST /api/webhook/handle` (write-scoped token, paged appends, `done` finalize → `produceFromRows` → `{ resultHandle }`), `@openapi` annotated.
- Edit: `callWebhook` — recognize a `{ resultHandle }` response and resolve it downstream; over-cap-no-handle still → `TOOLPACK_RUNTIME_TOO_LARGE`.
- Tests: spec unit 5 + integration 9 — a mock webhook stages a >1 MB result and returns a handle the portal resolves; opt-in only (small results inline).
- **Done when:** a webhook returns a large result as a handle past the old 1 MB cap.

## Slice 6 — Contract surfaces + docs
- Edit: `CUSTOM_TOOLPACK_INTEGRATION.md` (the three tiers + read/write protocol + verification snippets), the registration dialog reference/examples, the mock toolpack server (exercise pull-on-read + staging).
- Tests: doc/snippet consistency; mock server round-trips in the integration suite.
- **Done when:** a third-party author can implement all three tiers from the docs + mock server.

## Test plan summary
Per-slice unit green; the security slice (4) carries the adversarial integration tests (7, 8); outbound (5) carries 9. Final gate: full `test:unit` + `test:integration` + `lint` + `type-check`.

## Risks
| Risk | Mitigation |
|---|---|
| Read endpoint leaks across orgs/handles | Slice 4 isolated; fail-closed token validation; adversarial tests 7 are acceptance-blocking. |
| Token outlives its need | Revoke on settle (success + error) + short TTL bounded by the handle's. |
| Outbound staging unbounded | `produceFromRows` caps at `HANDLE_ROW_CAP`; same 24h TTL + eviction as any handle. |
| Substrate not yet on `main` | Slice 0 gates the whole plan on #144 merging; no slice starts before the rebase. |
