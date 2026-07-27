# Gate pinning of visualization blocks — Condensed design (#273)

**Issue:** [EnterpriseBT/portal-ai#273](https://github.com/EnterpriseBT/portal-ai/issues/273) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A pinned visualization would copy the block content verbatim — for a `d3` widget that's a render program plus a pipeline pointer, and the durable-dashboard model that would make such a pin meaningful is the follow-up epic. So this epic must not ship snapshot-pinning of visualizations. Surveying the branch, the *behavior* is already in place: the pinnable set is derived from `PortalResultTypeSchema`, `d3` was never added to it (#268 deliberately split display from pinnability), and #272 removed `vega`/`vega-lite` from the enum, the DB type, and the streaming paths. What is **not** in place is the ticket's second deliverable — the server rejection is untyped, returning a 400 under `PORTAL_RESULT_NOT_FOUND` — and nothing locks the gate against regression. This ticket closes that gap in `apps/api` (+ a web regression test).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Pinnable set | `packages/core/src/contracts/portal.contract.ts:178` | `new Set(PortalResultTypeSchema.options)` — single source of truth |
| Result-type enum | `packages/core/src/models/portal-result.model.ts:13` | `["text", "data-table"]` after #272 — no viz type present |
| Block-type enum | `packages/core/src/contracts/portal.contract.ts:162` | includes `d3`; deliberately **not** a result type |
| Pin affordance | `apps/web/src/components/PortalMessage.component.tsx:91`, `:204`, `:235-260` | `hasPinnableContent` gates the icon; already `false` for `d3` |
| Server guard | `apps/api/src/routes/portal-results.router.ts:155-163` | rejects non-pinnable types — but with `ApiCode.PORTAL_RESULT_NOT_FOUND` at 400 |
| Block-index guard | `apps/api/src/routes/portal-results.router.ts:143-151` | same misuse: 400 under `PORTAL_RESULT_NOT_FOUND` |
| OpenAPI 400 | `apps/api/src/routes/portal-results.router.ts:70-71` | "Invalid payload or block index out of range" — silent on non-pinnable types |
| Legacy rows | `apps/api/drizzle/0073_remove_vega_portal_result_types.sql:9` | #272 **deleted** pinned `vega`/`vega-lite` rows before recreating the enum |
| Contract test | `packages/core/src/__tests__/contracts/portal.contract.test.ts:167-180` | already asserts no viz type is pinnable |
| Route tests | `apps/api/src/__tests__/__integration__/routes/portal-results.router.integration.test.ts:139-221` | pin happy path, unknown portal, out-of-range index — no non-pinnable-type case |

## Decision — type the rejection, lock the gate; drop deliverable 3

The ticket's three deliverables resolve differently against the branch as it stands:

1. **Hide the pin affordance** — already true (`hasPinnableContent` excludes `d3`; vega types no longer exist). No code change; add the regression test that makes it stay true.
2. **Server-enforced with a typed `ApiCode`** — the guard exists, the code does not. Add `PORTAL_RESULT_TYPE_NOT_PINNABLE` and return it at 400. While the same handler is open, the block-index guard's identical misuse of `PORTAL_RESULT_NOT_FOUND` gets `PORTAL_RESULT_BLOCK_INDEX_INVALID` — one enum member and one line, in the `@openapi` block being edited anyway; branching on `NOT_FOUND` for a 400 is not a contract a client can use.
3. **Existing pinned visualization results remain listed/viewable** — **not satisfiable, and already settled the other way.** Migration `0073` deletes those rows; #272 took the clean cut (no production data). The deliverable is dropped; the issue body was amended (2026-07-27) to record it under Out of scope rather than let the ticket contradict this doc.

The alternative — a bare regression-test-only ticket, leaving the untyped code — was rejected: the ticket names server enforcement with a typed code as its deliverable, and a 400 carrying `PORTAL_RESULT_NOT_FOUND` is the exact "gates get server enforcement" failure the rule guards against.

## Plan — 1 slice

**Slice 1 — typed non-pinnable rejection + gate regression tests**

- **Files (edit):**
  - `apps/api/src/constants/api-codes.constants.ts` — add `PORTAL_RESULT_TYPE_NOT_PINNABLE`, `PORTAL_RESULT_BLOCK_INDEX_INVALID`.
  - `apps/api/src/routes/portal-results.router.ts` — use the two new codes at `:147` and `:159`; widen the `@openapi` 400 description (`:71`) to name the non-pinnable-type case.
- **Tests (test-first):**
  - `apps/api/src/__tests__/__integration__/routes/portal-results.router.integration.test.ts` — pinning a `d3` block returns 400 with `code: "PORTAL_RESULT_TYPE_NOT_PINNABLE"`; out-of-range index returns `PORTAL_RESULT_BLOCK_INDEX_INVALID`; the existing `text` happy path still 201s.
  - `apps/web/src/__tests__/PortalMessage.test.tsx` — `PortalMessageUI` with a `d3` block renders the widget but **no** pin/unpin button (`queryByLabelText`), while a `text` block in the same message still renders one.
- **Run:** `npm run test:unit`, the api integration suite, `npm run lint`, `npm run type-check`, `npm run format:check`.

## Smoke (manual, against your dev stack)

1. In a portal session, prompt for a chart. The `d3` widget renders; hovering it shows **no** pin icon.
2. In the same session, hover the assistant's text block and a data-table block — the pin icon still appears, and pinning one still works and lists under the station's pinned results.
3. `curl -X POST http://localhost:3001/api/portal-results -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' -d '{"portalId":"<id>","blockIndex":<d3 block index>,"name":"X"}'` → 400 with `code: "PORTAL_RESULT_TYPE_NOT_PINNABLE"`.
4. Same call with `"blockIndex": 999` → 400 with `code: "PORTAL_RESULT_BLOCK_INDEX_INVALID"`.
5. Previously pinned text/data-table results are unchanged — still listed, still viewable, still renameable and deletable.
6. `http://localhost:3001/api-docs` → `POST /api/portal-results` 400 description names the non-pinnable-type rejection.

## Out of scope

- The pinned-widget / dashboard model — the follow-up epic; this ticket gates, it does not redesign.
- Restoring or migrating pinned Vega rows — `0073` deleted them under #272's clean cut.
- Re-adding `d3` to `PortalResultTypeSchema`; that is the dashboards epic's call, and this doc's regression tests are the thing it will deliberately update.
