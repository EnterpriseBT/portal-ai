# Custom webhook compute scaling — Spec

**After this lands, a custom (webhook) compute tool scales over large datasets in *both* directions** — input past model-context size and output past the **1 MB** response cap (`TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES`) — **without rows ever entering the agent's context.** It is the **remote-transport adapter** for the shared scaling substrate #129 (the streamable cursor-backed handle) built for builtins: the same `getSnapshot` / cursor / `produce` machinery, now reachable across the webhook trust boundary. The custom-`consumption` registration gate (child I, locked to `none` "until #124") widens to `none | bounded | streaming`, each gated on its transport existing.

Discovery: `docs/WEBHOOK_COMPUTE_SCALING.discovery.md`. Issue: [#124](https://github.com/EnterpriseBT/portal-ai/issues/124). **Depends on #129** (`docs/STREAMABLE_CURSOR_HANDLE.*`, PR #144): `getSnapshot`, the cursor (`streamHandle`), `produce`, and the `QueryHandleEnvelope` are consumed as-is — this spec adds only the remote transport + the externally-supplied-rows producer. Builds on #114 (compute purity) and #121 (the `consumption` contract + `customToolCapabilityError` gate).

## Key decisions (flag for review)

1. **Input tier = the declared `consumption` (D1, confirmed).** The tier a webhook tool gets is the `consumption` its author declared — the runtime already selects builtin delivery by N + contract; this extends the same to the webhook body:
   - `none` → inline params (today, unchanged).
   - `bounded(maxRows, onOverflow)` → the server resolves the dataset (`resolveRecordSource`, ≤ `maxRows`) and POSTs `{ tool, input, records }` (the old #122 records-in-body).
   - `streaming` → the server hands the webhook a **paged pull-on-read** grant; the webhook fetches pages itself (no fat POST). `engine-pushdown` stays **rejected** for custom (no backend access).

2. **Inbound pull-on-read auth = a scoped, expiring, single-handle token (D2, confirmed — scoped token over HMAC-URL).** When the runtime dispatches a `streaming` webhook tool it **mints an opaque token**, stores it in Redis scoped to `(organizationId, handleId)` with a short TTL (`WEBHOOK_READ_TOKEN_TTL_MS`, bounded by the handle's remaining TTL), and passes it in the POST body alongside the read URL. A new endpoint **`GET /api/webhook/handle/:handleId?offset&limit`** authenticates the **token** (not a user JWT), validates `token → {organizationId, handleId}` + not-expired + `handleId` match, and serves a `getSnapshot` page (`limit ≤ 5000`). The token is **revoked** (Redis `DEL`) when the tool call settles — so the grant is "this webhook, this handle, until it returns or the TTL elapses." Read-only, single-handle, org-scoped; the user JWT is **never** exposed to a third party.

3. **Outbound = `produceFromRows` + an opt-in `{ resultHandle }` envelope (D3/D4, confirmed).** For a webhook that *produces* a large result, raising the 1 MB cap doesn't scale. Instead:
   - **`produceFromRows({ rows, schema?, stationId, organizationId })`** — a new entry to the existing producer that stages a **caller-supplied** row set into the same `QueryHandleEnvelope` / Redis batches (today `produce` is `sql`-only). The staging logic is orthogonal to row origin.
   - The webhook streams its output to a **staging write endpoint** (`POST /api/webhook/handle`, same token posture as D2 but **write-scoped**, paged), which calls `produceFromRows`, then **returns `{ resultHandle }`** in its small inline response. The portal resolves/streams it downstream like any handle.
   - **Opt-in** (D4): small/scalar results return inline as today (the common case per child-I `resultKind` analysis); only a webhook that declares/returns a handle takes the staging path. A response carrying neither inline-within-cap nor a `resultHandle` past the cap still → `TOOLPACK_RUNTIME_TOO_LARGE` (no silent truncation).

4. **Widen the registration gate to `none | bounded | streaming` (D5, confirmed).** `customToolCapabilityError`'s `allowedConsumptionModes` widens exactly as each transport lands (policy-(b): never a declarable-but-dead mode). `engine-pushdown` stays rejected for custom.

5. **Scope = whole-set reduce + large output; `map` stays `bulk_transform` (confirmed).** Per-record dispatch over a custom tool is already `bulk_transform` + `bulkDispatch`. #124 is the **whole-set input** (`bounded`/`streaming`) + **large output** the dispatcher doesn't cover. No overlap.

## Contracts

### `bounded` — records-in-body POST
`callWebhook` resolves the dataset and POSTs the existing signed body **plus** `records`:
```jsonc
{ "tool": "<slug>", "input": { … }, "records": [ { …row }, … ] }   // records.length ≤ maxRows
```
Over `maxRows` → the contract's `onOverflow` (`error` → `COMPUTE_INPUT_TOO_LARGE`; `sample` → flagged sample; `stream` → escalate to the `streaming` tier). HMAC signing (`signRequest`) unchanged — `records` is inside the signed body.

### `streaming` — pull-on-read body + read endpoint
POST body carries a **source grant** instead of rows:
```jsonc
{ "tool": "<slug>", "input": { … },
  "source": { "readUrl": "https://…/api/webhook/handle/<handleId>",
              "readToken": "<opaque>", "rowCount": 1234567,
              "schema": [ { "name": "…", "type": "…" } ], "pageLimit": 5000 } }
```
- `GET /api/webhook/handle/:handleId?offset&limit` — `Authorization: Bearer <readToken>`. 200 → `{ rows, total, offset, limit }` (a `getSnapshot` page; or a cursor page for a >`HANDLE_ROW_CAP` handle via #129's `streamHandle`, forward-only). 401 `WEBHOOK_READ_TOKEN_INVALID` / `WEBHOOK_READ_TOKEN_EXPIRED`; 403 on org/handle mismatch; `limit` clamped to ≤ 5000.

### Outbound — staging write + result envelope
- `POST /api/webhook/handle` — `Authorization: Bearer <writeToken>`, body `{ rows, schema?, done? }` (paged appends; `done:true` finalizes). Finalize → `produceFromRows` → `{ resultHandle }`.
- The webhook's tool response, when opting into a handle: `{ resultHandle: "qh-…" }` (recognized by the runtime; resolved downstream). Small results: inline as today.

### New error codes (`api-codes.constants.ts`)
`WEBHOOK_READ_TOKEN_INVALID`, `WEBHOOK_READ_TOKEN_EXPIRED`, `WEBHOOK_HANDLE_SCOPE_MISMATCH`, `WEBHOOK_RESULT_HANDLE_INVALID`.

## Changed files

| File | Change |
|---|---|
| `apps/api/src/services/portal-sql-handle.service.ts` | `produceFromRows({rows, schema?, stationId, organizationId})` — externally-supplied-rows producer (shares the staging/envelope path with `produce`) |
| `apps/api/src/services/webhook-read-token.service.ts` (new) | mint / validate / revoke scoped read+write tokens in Redis (`(org, handle, mode)`, short TTL) |
| `apps/api/src/routers/webhook-handle.router.ts` (new) | `GET /api/webhook/handle/:handleId` (paged read), `POST /api/webhook/handle` (paged staging write); token-authed, `@openapi` annotated |
| `apps/api/src/services/tools.service.ts` | `callWebhook`: tier the body by `consumption` (`bounded` → `records`; `streaming` → mint token + `source` grant + revoke on settle); recognize `{ resultHandle }` responses |
| `apps/api/src/services/toolpack-registration.service.ts` | widen `allowedConsumptionModes` → `["none","bounded","streaming"]` |
| `packages/core/src/constants/large-data-ops.constants.ts` | `WEBHOOK_READ_TOKEN_TTL_MS` |
| `apps/api/src/constants/api-codes.constants.ts` | the four new codes |
| `docs/CUSTOM_TOOLPACK_INTEGRATION.md` + the registration dialog reference + the mock toolpack server | document the three tiers, the read/write protocol, verification snippets |

## Tests

**Unit**
1. `produceFromRows` — stages a supplied row set into the same envelope/Redis batches `produce` does; `getSnapshot` reads them back; schema derived/honored.
2. token service — mint→validate round-trips; wrong handle / wrong org / expired / revoked all fail closed; write vs read scope not interchangeable.
3. `callWebhook` `bounded` — resolves ≤`maxRows` and POSTs `{tool,input,records}`; over-bound applies `onOverflow`; `records` is inside the signed body.
4. `callWebhook` `streaming` — mints a token, POSTs the `source` grant (no `records`), revokes the token after the call settles (success **and** error paths).
5. `callWebhook` outbound — a `{ resultHandle }` response resolves downstream; an over-cap response with neither inline-fit nor handle → `TOOLPACK_RUNTIME_TOO_LARGE`.
6. registration gate — `bounded`/`streaming` now accepted for custom; `engine-pushdown` still rejected.

**Integration (security-sensitive — adversarial)**
7. read endpoint: a valid token pages a real handle (paged, `limit` clamped); **another org's token** for the same handle → 403; **expired/revoked** token → 401; a token for handle A used on handle B → 403; user-JWT-only (no token) → 401.
8. round-trip: produce a handle → dispatch a mock `streaming` webhook that pulls all pages via the endpoint → fold/return; assert the webhook saw every row once and the user JWT never left the portal.
9. outbound round-trip: a mock webhook stages a >1 MB result via the write endpoint and returns `{ resultHandle }`; the portal resolves it past the old inline cap.

## Acceptance criteria
- [ ] `produceFromRows` stages caller-supplied rows into a readable handle (test 1).
- [ ] Read/write tokens are scoped `(org, handle, mode)`, short-TTL, revocable, fail-closed (tests 2, 7).
- [ ] `callWebhook` tiers by `consumption`: `bounded` POSTs resolved `records`; `streaming` mints a grant + pull-on-read + revokes on settle (tests 3, 4).
- [ ] Outbound `{ resultHandle }` resolves; over-cap-no-handle still errors (test 5).
- [ ] Gate widened to `none|bounded|streaming`; `engine-pushdown` rejected for custom (test 6).
- [ ] The read endpoint is adversarially safe (test 7); the user JWT never crosses to a third party (test 8).
- [ ] `@openapi` on both new routes; `CUSTOM_TOOLPACK_INTEGRATION.md` + dialog reference + mock server updated.
- [ ] `test:unit` + `test:integration` + `lint` + `type-check` green.

## What this doesn't decide
- **The built-in compute path** — already handle-backed (#114), unchanged.
- **`map` over large data** (`bulk_transform`/`bulkDispatch`) and **SQL-reduce** (`bulk_aggregate`) — exist; out of scope.
- **The cursor substrate itself** (#129) — consumed as the foundation, not (re)built here.
- **Per-webhook quota/billing** beyond the TTL + `HANDLE_ROW_CAP` staging cap — a later concern.
- **Re-deciding the #121 capability model** — only the custom gate widens.

## Sequencing note
Implementation **depends on #129 (#144) merging** — `produceFromRows` extends `produce`, the read endpoint serves `getSnapshot`/`streamHandle`, and the substrate must be on `main` first. This branch rebases onto `main` after #144 merges; the plan's slices are then *purely the remote adapter*.
