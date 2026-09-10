# Redact DB-error PII from logs — Condensed design (#540)

**Issue:** [EnterpriseBT/portal-ai#540](https://github.com/EnterpriseBT/portal-ai/issues/540) · Bug · **condensed**.

**Why.** Raw DB errors leak customer row values into the JSON log sink (stdout → CloudWatch). `PostgresError` carries the value in `detail` (`Key (email)=(alice@corp.com) …`) plus `where`/`table`/`column`/`constraint`; postgres.js makes them enumerable (`Object.assign(this, wireFields)`), and pino's default `err` serializer copies every enumerable prop + attaches `.raw`. `DrizzleQueryError.message` is the full SQL + bound params. Touches `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| logger config | `src/utils/logger.util.ts` | `err: pino.stdSerializers.err`; `redact.paths` = secret-shaped keys only |
| worst offender | `bulk-transform.processor.ts:544` | logged `err: err.message` (the full SQL+params) |
| raw-string log sites | `rest-api.adapter.ts` (×4), `wide-table.repository.ts`, `record-import.util.ts`, `db-migrate.ts`, 3 wide-table-reconcile tool logs | logged `cause:`/`error: err.message` — bypass the `err` serializer |
| out of scope | tool `return { error: err.message }`, `ApiError` `details.cause` | **client-facing responses**, not logs; and the `err` serializer drops `ApiError.details` anyway |

## Decision — allowlist `err` serializer + convert raw-string sites to Error objects

1. **Central `sanitizeError` serializer** (registered for **both** `err` and `error` keys — the codebase uses both). It's an **allowlist**: emits only `type`, sanitized `message`, `stack`, and safe scalar codes (`code`/`status`/…), recursing `cause`. So a value can never *structurally* reach a log, even for an unseen error field. DB messages reduce to their class (`Database query failed` / `Database error (23505)`). **The stack is rebuilt from its call frames when the message was sanitized** — the header line `<name>: <message>` would otherwise re-leak the (multi-line) SQL+params. `redact.paths` gains `err.*`/`err.cause.*` DB fields as scoped defense-in-depth (not `*.` — no over-reach).
2. **Per-site:** the raw-string log sites (which bypass the serializer) now log the Error object (`err`) so it's sanitized; `bulk-transform` keeps its short `message` only for the persisted `jobs.result` (the org's own surface).

## Plan — 1 slice

**Files** — `logger.util.ts` (serializer + redact); `bulk-transform.processor.ts`; `rest-api.adapter.ts` (×4); `wide-table.repository.ts`; `record-import.util.ts`; `db-migrate.ts`; `connector-entity-create.tool.ts`; `field-mapping-create.tool.ts`; `field-mapping-delete.tool.ts`.

**Tests** — `logger.util.test.ts`: assert a fake `PostgresError`/`DrizzleQueryError` serialize with no customer value / SQL / params anywhere (incl. stack), messages reduced to class, plain errors intact, non-Error → `{type}` only, and a pino-stream test proving both `err`/`error` keys are covered.

## Smoke (suites, per #551 disposition)

1. api `type-check` · `lint` · `logger.util` (9) — green. ✓
2. touched-file suites (bulk-transform / rest-api / wide-table / tools / record-import) — 538 pass. ✓
3. Manual (optional, dev): force a unique-violation import; the JSON log line shows `err: { type, message: "Database error (23505)", code, stack(frames-only) }` — **no `detail`, no email, no SQL/params**.

## Out of scope

- Client-facing error responses (tool results, `ApiError` payloads) — a different surface than logs.
- Non-DB error messages (e.g. `JsonataSuggestError.message`) — not customer data.
