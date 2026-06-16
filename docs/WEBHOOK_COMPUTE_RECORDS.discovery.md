# Custom-webhook compute tools: server-side handle resolution — Discovery

**Issue:** [EnterpriseBT/portal-ai#122](https://github.com/EnterpriseBT/portal-ai/issues/122)

**Why this exists.** #114 made the 18 built-in compute tools pure: they receive data as input via `withComputeInput` + `resolveComputeRecords`, which materializes a `sql_query` `queryHandle` into rows server-side (capped at `COMPUTE_MAX_ROWS`) so the rows never pass through the model context. It also *documented* one shared contract — records-as-input — for built-in **and** custom tools, but only implemented the built-in side.

A **custom** (org-uploaded webhook) compute tool today can only receive the rows the agent can fit inline in the tool's declared `parameterSchema` — i.e. capped at model-context size. This is the follow-up that gives custom compute tools the same handle-backed scale: the portal resolves the handle server-side and POSTs the materialized rows into the webhook body. This is the change that makes the #114 "one contract for built-in and custom" claim actually true.

## The current shape

### WebhookTool + callWebhook

| Symbol | Where | Role |
|---|---|---|
| `WebhookTool` | `apps/api/src/tools/webhook.tool.ts:20-92` | Wraps a custom tool's `{name, description, parameterSchema}`; `build()` converts the JSON Schema to Zod (`jsonSchemaToZod`) and returns an AI-SDK `tool()` whose `execute` calls `callWebhook` |
| body shape | `webhook.tool.ts:68` | `execute` calls `ToolService.callWebhook(impl, { tool, input })` |
| `ToolService.callWebhook` | `tools.service.ts:352-406` | POSTs `JSON.stringify(input)` to the runtime URL; HMAC-signs via `signRequest` (`:366`), 30s timeout, response capped by `readResponseTextWithCap` |

The injection point for resolved rows is the body built at `webhook.tool.ts:68` (before `callWebhook`), or inside `callWebhook` before stringify+sign.

### Custom-toolpack registration + the wire schema

`ToolpackToolDefinitionSchema` (`packages/core/src/models/organization-toolpack.model.ts:70-82`) is the Zod wire schema for each custom tool — `name`, `description`, `parameterSchema`, optional `bulkDispatch`. It's validated at registration by `ToolpackRegistrationService.fetchSchema` (`apps/api/src/services/toolpack-registration.service.ts`) and cached in `organization_toolpacks`; on station enablement the tools are hydrated into `WebhookTool`s in `buildAnalyticsTools` (`tools.service.ts:631-659`).

### The `bulkDispatch` precedent (the opt-in flag pattern to mirror)

`BulkDispatchMetadata` (`organization-toolpack.model.ts:49-66`) is an optional flag declared identically on the wire schema and the builtin `ToolpackTool` (`builtin-toolpacks.ts:59-68`). At runtime `ToolService.lookupBulkDispatchable` (`tools.service.ts:250-341`) checks the descriptor (built-in) or cached definition (webhook) and, if present, wraps the executor. A `consumesRecords` flag follows the exact same declare → register → runtime-check path.

### The seam to reuse

`withComputeInput(shape)` and `resolveComputeRecords(input)` (`apps/api/src/tools/compute-input.util.ts:37-115`) already do the work: the wrapper adds the `queryHandle` XOR `rows` fields; the resolver pulls rows from the handle via `PortalSqlHandleService.getSnapshot` (capped at `COMPUTE_MAX_ROWS`, `packages/core/src/constants/large-data-ops.constants.ts`), throwing `COMPUTE_INPUT_TOO_LARGE` over-cap. Both are reusable verbatim from the webhook path — this ticket is mostly *wiring*, not new compute logic.

### Caps + signing

`callWebhook` caps the **response** (`readResponseTextWithCap` / `TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES`, `tools.service.ts:77-127`) but there is **no request-size cap** today. HMAC signing (`webhook-signing.util.ts`) signs over `<ts>.<id>.<body>` *after* stringification (`tools.service.ts:366`), so mutating the body to include records before signing is correct — the records are covered by the signature.

### Contract surfaces presented to authors + users

The `{tool, input}` runtime body is described in several places that must move to `{tool, input, records}` (for `consumesRecords` tools) so authors aren't misled:

| Surface | Where | What it says today |
|---|---|---|
| Registration form helper | `apps/web/src/components/RegisterToolpackDialog.component.tsx:325` | *"POST endpoint invoked per tool call with `{tool, input}`."* |
| Runtime request example | `RegisterToolpackDialog.component.tsx:492-495` (`RUNTIME_REQUEST_EXAMPLE`) | `{ "tool": "...", "input": {...} }` |
| Edit form | `apps/web/src/components/EditToolpackDialog.component.tsx:256-376` | same fields/helpers as register |
| Author help doc | `docs/CUSTOM_TOOLPACK_INTEGRATION.md:17,~325` | runtime body `{ tool, input }`; signing over `<ts>.<id>.<rawBody>` |
| Reference impl | `apps/api/src/scripts/mock-toolpack-server.ts:548-549` | `const { tool, input } = req.body` |
| Wire contract | `packages/core/src/contracts/toolpack.contract.ts:19-33` (`ToolpackToolSchema`) | `{ name, description, parameterSchema, examples? }` — no `consumesRecords` |

**The forms collect URLs + auth headers only** — tool definitions come from the author's served `/schema`, so `consumesRecords` is **author-declared there, not a portal form field.** The frontend change is therefore **copy/example alignment, not a new input.** Signing is over the whole body, so the verification snippets stay valid once their example body is updated.

## The design space

### Decision 1 — POST body shape for the resolved rows

**A. Top-level `{ tool, input, records }`.** Strip `queryHandle`/`rows` from `input`; portal-injected data sits beside the agent's scalar params. **B. Inject as `input.records`.** Rows live inside the existing `input` object.

| | A top-level `records` | B `input.records` |
|---|---|---|
| Agent params vs portal data | cleanly separated | mixed into `input` |
| Webhook author mental model | "you get `input` (what the agent asked) + `records` (the data)" | one bag |
| Back-compat with existing `{tool,input}` | additive | additive |

**Lean: A.** Keep `input` = the agent's declared scalar params; `records` is portal-materialized data. Document the webhook contract: a `consumesRecords` tool receives `{ tool, input, records }`.

### Decision 2 — Where resolution happens

**A. In `WebhookTool.execute`** — detect the data source in validated input, `resolveComputeRecords`, strip the source fields, call `callWebhook` with `records`. `callWebhook` stays generic. **B. In `callWebhook`** — generic call path grows compute awareness.

**Lean: A.** Resolution lives in the records-consuming tool's `execute`; `callWebhook` remains a dumb transport. Mirrors how built-in tools call `resolveComputeRecords` in their own `execute`.

### Decision 3 — Injecting the data-source params into the agent-facing schema

The webhook tool's agent-facing schema comes from JSON-Schema→Zod (`jsonSchemaToZod`). For a `consumesRecords` tool the agent must see `queryHandle`/`rows`. **A. Wrap the built Zod schema with `withComputeInput`** in `WebhookTool.build()` (or in `buildAnalyticsTools` before build). **B. Splice the data-source fields into the JSON Schema** before conversion.

**Lean: A.** Reuse `withComputeInput` on the converted Zod object so built-in and webhook compute tools present an identical agent-facing surface (`queryHandle` XOR `rows` + the tool's declared params).

### Decision 4 — The cap for webhook-injected records

Built-in compute resolves up to `COMPUTE_MAX_ROWS` (100k) **in-process** — cheap. Shipping 100k rows over HTTP to a third party is not. **A. Reuse `COMPUTE_MAX_ROWS` (row cap only).** **B. Reuse the row cap *and* add a request-byte cap** (`TOOLPACK_RUNTIME_MAX_REQUEST_BYTES`) checked on the serialized body before send. **C. A separate, lower webhook-specific row cap.**

| | A row cap only | B row cap + byte cap | C lower webhook row cap |
|---|---|---|---|
| Bounds runaway POST size | no (100k wide rows = many MB) | yes | partially |
| Symmetry with built-ins | full | full + byte guard | divergent |

**Lean: B.** Keep `COMPUTE_MAX_ROWS` as the row bound (symmetry + reuse), add a request-byte cap as defense — over either → `COMPUTE_INPUT_TOO_LARGE`. Avoids a second magic row number while still bounding payload bytes.

### Decision 5 — Where `consumesRecords` is declared

**Lean: add `consumesRecords?: boolean` to `ToolpackToolDefinitionSchema`** (the wire schema — the functional flag the portal acts on) and mirror it on the builtin `ToolpackTool` descriptor for type/doc parity. It's functionally a *webhook* concept (built-in compute tools already wrap their own schema with `withComputeInput` in code, so they don't read the flag); the registration endpoint validates it.

## Tradeoff comparison

|  | D1 top-level records | D2 resolve in execute | D3 withComputeInput wrap | D4 row+byte cap |
|---|---|---|---|---|
| Spread to spec | Yes — body contract | Yes — call path | Yes — schema injection | Yes — caps + error |
| Reuses #114 seam | n/a | yes | yes | yes |

## Recommendation

1. Add `consumesRecords?: boolean` to `ToolpackToolDefinitionSchema` and the builtin `ToolpackTool` type; validate it at toolpack registration.
2. For a `consumesRecords` webhook tool, wrap its converted Zod schema with `withComputeInput` so the agent passes a `queryHandle` (or inline `rows`) exactly as for a built-in compute tool.
3. In `WebhookTool.execute`, call `resolveComputeRecords` server-side, strip the source fields from `input`, and POST `{ tool, input, records }` to the runtime.
4. Bound the injection by `COMPUTE_MAX_ROWS` (rows) **and** a new request-byte cap; over either → `COMPUTE_INPUT_TOO_LARGE`. Resolution + injection happen before HMAC signing so the records are signed.
5. **Align every contract surface** to `{tool, input, records}` (records present only for `consumesRecords` tools): the registration/edit form helper text + `RUNTIME_REQUEST_EXAMPLE` (`RegisterToolpackDialog`/`EditToolpackDialog`), the author help doc `CUSTOM_TOOLPACK_INTEGRATION.md`, the verification snippets' example body, and a records-consuming example tool in `mock-toolpack-server.ts`. The forms gain **no new field** — `consumesRecords` is author-declared in the served `/schema`; this is copy/example/doc work. (Optional nicety: a read-only "consumes records" badge per tool from the fetched schema in the metadata modal.)

## Open questions

1. **Required-vs-optional source for webhook compute tools.** `withComputeInput` enforces *exactly one* of `queryHandle`/`rows`. Some tools might want an optional source (cf. built-in `hypothesis_test`). **Lean: require XOR for v1** — a `consumesRecords` tool consumes records by definition; add an optional-source variant only if a real webhook tool needs it.
2. **Request-byte cap value + env knob.** What ceiling, and is it configurable like `TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES`? **Lean: a `TOOLPACK_RUNTIME_MAX_REQUEST_BYTES` env (default a few MB), mirroring the response cap.**
3. **Data egress to third parties.** Resolving a handle ships the org's own rows to the org's registered webhook. **Lean: same trust model as today** — custom tools already receive agent-passed data; the org opted in by registering + enabling the toolpack. No new gate; note it in the spec's risks.
4. **Built-in descriptor parity.** Do built-in compute tools need `consumesRecords` set in `builtin-toolpacks.ts`? **Lean: optional/doc-only** — built-ins wrap `withComputeInput` in code and don't read the flag; set it for `/api/toolpacks` accuracy if cheap, else skip.

## What this doesn't decide

- **The built-in compute path** — shipped in #114; untouched here.
- **Toolpack reorganization / the tool-taxonomy investigation** — separate, larger effort.
- **A general webhook request-size cap for non-compute tools** — this ticket adds the cap for records injection; whether all webhook calls get a request-byte cap is a small adjacent hardening, mention but don't scope.
- **`bulk_transform` tool-dispatch of webhook tools** (per-record map) — already works via `bulkDispatch`; this ticket is the *reduce*/whole-dataset records path, orthogonal.

## Next step

Write `docs/WEBHOOK_COMPUTE_RECORDS.spec.md` (the `consumesRecords` wire-schema addition, the `withComputeInput` wrap point in `WebhookTool`/`buildAnalyticsTools`, the `{tool,input,records}` body contract, the row+byte caps + error code) and `.plan.md` (TDD slices). Likely slices: (1) `consumesRecords` schema + registration validation; (2) agent-facing schema injection + `resolveComputeRecords` + `{tool,input,records}` body in `WebhookTool`; (3) request-byte cap; (4) integration test (mock webhook receives resolved records from a real handle; over-cap → `COMPUTE_INPUT_TOO_LARGE`); (5) **contract-surface alignment** — registration/edit form helper text + `RUNTIME_REQUEST_EXAMPLE`, `CUSTOM_TOOLPACK_INTEGRATION.md` + verification-snippet body, and a records-consuming example in `mock-toolpack-server.ts`.
