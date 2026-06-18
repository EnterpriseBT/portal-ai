# Custom webhook compute scaling — Discovery

**Issue:** [EnterpriseBT/portal-ai#124](https://github.com/EnterpriseBT/portal-ai/issues/124)

**Why this exists.** A custom (webhook) compute tool today can only receive whatever rows fit inline in its declared `parameterSchema`, and can only return whatever fits in a **1 MB** response (`TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES`; over it → `502 TOOLPACK_RUNTIME_TOO_LARGE`). So a third-party tool that reduces or maps over a large dataset is capped at model-context size on the way in and 1 MB on the way out. #114 gave *built-in* compute tools handle-backed scale (`resolveComputeRecords`), and #121 built the substrate — the capability model with a `consumption` contract, the `resolveRecordSource` abstraction, and custom-pack registration that **gates custom `consumption` to `none` "until #124."** This is the feature that ships the transport behind that gate and **widens it** — scaling custom compute over large data in *both* directions without rows ever entering the agent's context.

## One substrate, two localities

Dataset scaling is **not** a webhook problem — it is one origin-agnostic substrate that every dataset-consuming tool shares. A tool (builtin, system, or custom) is a pure function over a record-source with a declared `consumption`; the handle / paged snapshot / **cursor** / `resolveRecordSource` / `produceFromRows` machinery is built **once** and serves all of them. The only thing that varies is **locality**:

- **In-process** (builtin / system): the runtime hands records directly — an in-memory array, or it iterates the cursor in-process. No transport, no auth.
- **Remote** (custom webhook): the *same* record-source must cross a network boundary — pushed (`records` in the POST body) or pulled (the webhook fetches pages from an authed endpoint) — and produced output is staged and returned as a handle ref. The authed read/write endpoint is the **only** genuinely new surface, and it exists *only* because data leaves the trust boundary.

So **#124 is the remote-transport adapter for the shared scaling substrate, not a separate solution.** The sequencing follows directly: **build the in-process substrate first** — the streamable, cursor-backed handle that makes *builtin* compute exact past `HANDLE_ROW_CAP` (this is the work formerly tracked as #129) — then #124 is a thin adapter (serialize records / the authed endpoint / `produceFromRows`) over a substrate that already works and is already exercised by builtins. Building the webhook transport first would mean standing up a throwaway "minimal cursor" inside #124; building the substrate first means #124 is genuinely just the adapter. This makes the taxonomy's "unbounded, seamless for every operation" true in-process first, then extends it across the network.

## The current shape

### The webhook runtime call
`WebhookTool.execute` → `ToolService.callWebhook(impl, { tool, input })` (`tools.service.ts:350`) POSTs `JSON.stringify({ tool, input })` to the toolpack runtime URL, HMAC-signed via `signRequest` (`webhook-signing.util.ts:43` → `X-Portalai-Timestamp` / `-Webhook-Id` / `-Signature: v1=…`). The response is read by `readResponseTextWithCap(resp, TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES)` (`tools.service.ts:388`) — **1 MB**, content-length pre-check + mid-stream abort, `502 TOOLPACK_RUNTIME_TOO_LARGE` on overflow.

### What #121 already gave us (the substrate this builds on)
- **`consumption` contract** (`tool-capability.model.ts:25`): `none | engine-pushdown | streaming | bounded(maxRows,onOverflow)`.
- **`resolveRecordSource(input, consumption)`** (`record-source.ts:79`) — materializes a handle/inline rows by the cheapest mechanism for N, bounded by the contract; `getSnapshot(handleId,{offset,limit})` paged reads (limit ≤ 5 000).
- **Custom-pack registration gate** (`toolpack-registration.service.ts:212`): `customToolCapabilityError(cap, { allowedConsumptionModes: ["none"] })` — *the gate #124 widens.*
- **`produce`** (`portal-sql-handle.service.ts:90`) stages rows in Redis and returns a `QueryHandleEnvelope` — **but only from a `sql` string; it has no externally-supplied-rows entry** (the outbound blocker).

### Existing handle-read endpoints (the inbound-pull prior art)
`portal-sql-handle.router.ts`: `GET /api/portal-sql/handle/:handleId?offset&limit` (JWT, paged snapshot) and `GET /api/sse/portal-sql/handle/:handleId/stream?token=` (query-param JWT, Redis pub/sub). Both authenticate the **user**; #124 needs an endpoint that authenticates the **third-party webhook server**.

## The design space

The issue frames three tiers. Grounded in the code, they map cleanly onto the `consumption` modes the registration gate already knows about — so the tier a tool gets is **the consumption it declares**, and #124 is "build the transport for `bounded` + `streaming`, widen the gate, add the outbound path."

### Decision 1 — Input tiers keyed off the declared `consumption`
**A. One transport (always records-in-body).** **B. Tier by `consumption`:** `bounded` → server resolves the handle (`resolveRecordSource`) and POSTs `{ tool, input, records }` (≤ `maxRows`); `streaming` → server hands the webhook a signed paged **read URL** and the webhook *pulls* pages itself; `none` → inline params (today). The runtime already selects delivery by N + contract for built-ins — this extends the same to the webhook body.

| | A single | B tier by consumption |
|---|---|---|
| Reuses `resolveRecordSource` / the contract | partial | yes |
| Output scales with input | no (still 1 MB cap) | paired with D3 |
| Large input without a fat POST | no | yes (streaming pulls) |

**Lean: B.** `bounded` = the old #122 records-in-body (server POSTs resolved rows); `streaming` = pull-on-read. The consumption mode the author declares *is* the tier; registration (child I) already validates it — #124 widens the allowed set to include them.

### Decision 2 — Inbound pull-on-read: how the webhook is authorized to read a handle
The streaming tier hands the webhook a **short-lived, signed, paged read URL** for the `queryHandle`; the webhook GETs pages (reusing `getSnapshot`). The new endpoint is **ingress authenticated to a third party** — the security-sensitive surface.

**A. HMAC-signed URL** (reuse the per-toolpack `signingSecret` + `signRequest` pattern; the portal signs a URL the webhook replays with the signature headers, verified server-side). **B. Opaque scoped bearer token** minted per call, org+handle-scoped, short TTL, stored in Redis alongside the handle. **C. Reuse the user-JWT snapshot endpoint** — rejected: it authenticates the user, not the webhook, and would leak a user token to a third party.

| | A HMAC-signed URL | B scoped bearer token |
|---|---|---|
| New secret material to manage | no (reuses signing secret) | yes (mint/store/expire) |
| Scope to one handle + org | via signed claims | via token record |
| Revocable mid-flight | only via TTL | yes (delete the record) |

**Lean: B (scoped, expiring, handle+org-bound token), with the HMAC pattern as the fallback.** A per-call token that the runtime mints, stores in Redis with the handle's TTL, and the read endpoint validates is the cleanest "this webhook, this handle, for the next N minutes" grant — revocable and never exposing the signing secret in a URL. Settle in the spec; either way the endpoint is **handle+org-scoped, short-TTL, paged, read-only**.

### Decision 3 — Outbound: return-a-handle for large webhook output
For a webhook that *produces* a large result, the 1 MB response cap is the wall. **A. Just raise the cap** — rejected (doesn't scale; rows still flow inline). **B. The webhook stages its output and returns a handle ref.** Two shapes: **B1** the webhook writes to a portal **staging upload endpoint** (authed like D2) and returns `{ queryHandle }`; the portal resolves/streams it downstream. **B2** the webhook returns inline rows up to the cap, and a `truncated` + continuation only past it (half-measure).

This needs **`produce` to accept externally-supplied rows** — today it's `sql`-only (`ProduceOptions { stationId, organizationId, sql }`). Add a `produceFromRows({ rows, schema? })` that stages a caller-supplied row set into the same envelope/Redis batches (the staging logic is orthogonal to where rows come from).

**Lean: B1 + `produceFromRows`.** Symmetric with the input side: results become a handle the rest of the stack already knows how to read (snapshot/stream/aggregate-before-render). The response envelope carries `{ resultHandle }` instead of inline rows when the webhook opts in.

### Decision 4 — How the webhook signals "my output is a handle"
**A. Always stage** every webhook result as a handle — rejected (wasteful for small/scalar results, which are the common case). **B. The webhook opts in** via a response envelope (e.g. `{ handle: { uploadUrl } }` it wrote to, or a sentinel the runtime recognizes) — small results return inline as today, large ones return a handle ref. **Lean: B** — opt-in keeps the scalar/small path (the majority for custom tools, per child I's resultKind analysis) unchanged.

### Decision 5 — Widen the registration gate (the #121 seam)
Child I gated custom `consumption` to `["none"]` "until #124." #124 widens it: `["none", "bounded", "streaming"]`, and the runtime feeds each (`bounded` → records-in-body, `streaming` → pull-on-read). `engine-pushdown` stays rejected for custom (no backend access). **Lean: widen to `none|bounded|streaming` exactly when their transports land** — gate each mode on its transport existing, so there's never a declarable-but-dead mode (the same policy-(b) discipline child I used).

## Tradeoff comparison

|  | D1 tier by consumption | D2 scoped read token | D3 produceFromRows | D4 opt-in output | D5 widen gate |
|---|---|---|---|---|---|
| Spreads to spec | the 3 transports | the new endpoint + auth | the staging method | the response envelope | the gate change |
| New security surface | — | **yes (third-party ingress)** | staging upload (same auth) | — | — |
| Reuses #121 | `resolveRecordSource` | `getSnapshot` | `produce` envelope | — | `customToolCapabilityError` |

## Recommendation

1. **Tier the input transport by the declared `consumption`** (D1): `bounded` → server-resolved `{ tool, input, records }` POST (≤ `maxRows`); `streaming` → signed paged pull-on-read; `none` → inline (today).
2. **Inbound pull-on-read = a handle+org-scoped, short-TTL, paged, read-only endpoint** (D2), authenticating the webhook server (scoped token; HMAC fallback) — never the user JWT.
3. **Outbound = `produceFromRows` + an opt-in `{ resultHandle }` response envelope** (D3/D4); small results stay inline.
4. **Widen the registration gate** to `none|bounded|streaming`, each gated on its transport (D5).
5. **Deliverable: spec + plan** slicing into (a) `produceFromRows`, (b) the records-in-body POST + gate widening for `bounded`, (c) the signed read endpoint + pull-on-read for `streaming`, (d) the outbound `{ resultHandle }` path, (e) contract-surface + docs (the dialog reference, `CUSTOM_TOOLPACK_INTEGRATION.md`, the mock toolpack server).

## Open questions

1. **Scoped token vs HMAC-signed URL for the read endpoint (D2)?** **Lean: scoped expiring token** — revocable, never puts the signing secret in a URL. Confirm against the existing signing posture in the spec.
2. **Relationship to the cursor substrate (#129)?** Resolved by the "one substrate, two localities" framing: the streamable cursor is **shared in-process scaling**, not webhook-specific. **Lean: un-park #129 and build it first** as the builtin/shared substrate (exercised by the streaming escape-hatch tools — `forecast`/`technical_indicator`/`portfolio_metrics` past `HANDLE_ROW_CAP`), then #124 consumes the *same* cursor remotely via the authed read endpoint. (This reverses the earlier "fold a minimal cursor into #124" lean — the cursor isn't #124's to own; #124 is its first *remote* consumer.) Worth confirming a concrete builtin >100k streaming-reduce need exists to anchor the substrate; otherwise the in-process tier is thin and #124 stays its primary driver.
3. **Read-endpoint rate/scope limits** — pages ≤ 5 000 rows (existing `getSnapshot` cap), but what total-pull ceiling / rate per webhook? **Lean: reuse `HANDLE_ROW_CAP` semantics + a per-token page-rate cap; surface overflow, don't hang.**
4. **Outbound staging quota / GC** — a webhook staging a result handle consumes Redis under the 24 h TTL like any handle. **Lean: same TTL + the existing handle eviction; cap the staged row count at `HANDLE_ROW_CAP`.**
5. **`map` (per-record dispatch) vs `reduce`/whole-set for custom tools** — `bulk_transform`'s `bulkDispatch` already maps a custom tool per-record. Is #124 only the reduce/whole-set path? **Lean: yes — map-over-large is `bulk_transform` (existing); #124 is the whole-set input + large output the dispatcher doesn't cover.**

## What this doesn't decide

- **The built-in compute path** — already handle-backed (#114); unchanged.
- **`map` over large data** (`bulk_transform` + `bulkDispatch`) and **SQL-reduce over large data** (`bulk_aggregate`) — already exist; out of scope.
- **The cursor substrate itself** (#129) — it is *sequenced before* #124 as the shared in-process scaling foundation (see "One substrate, two localities"), not built inside #124. #124 consumes it; it does not own it.
- **Re-deciding the #121 capability model** — consumed as settled; #124 only widens the custom gate and feeds the declared modes.

## Next step

**#124 sequences after the shared cursor substrate (#129, un-parked).** First build the in-process streamable handle (the cursor) and wire the builtin streaming escape-hatch tools to it — that is the substrate this adapter rides on. *Then* write `docs/WEBHOOK_COMPUTE_SCALING.spec.md` (the `{ tool, input, records }` POST contract; the signed read-endpoint shape + auth; `produceFromRows`; the `{ resultHandle }` response envelope; the widened gate) and `docs/WEBHOOK_COMPUTE_SCALING.plan.md`. With the substrate in place, #124's slices are *purely the adapter*: records-in-body (`bounded`) + gate-widen → signed read endpoint + pull-on-read over the existing cursor (`streaming`) → outbound `{ resultHandle }` via `produceFromRows` → contract-surface/docs/mock-server — each green-testable on its own, the security-sensitive read endpoint isolated in its own slice with adversarial tests.
