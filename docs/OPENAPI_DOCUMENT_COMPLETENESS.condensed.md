# OpenAPI document completeness — Condensed design (#420)

**Issue:** [EnterpriseBT/portal-ai#420](https://github.com/EnterpriseBT/portal-ai/issues/420) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The OpenAPI document has three defects of one class: 3 operations declare no `responses:` at all, 10 `$ref`s point at components that were never registered, and 7 routes carry no `@openapi` block. A client author reading `/api/docs/spec` gets an empty schema where a payload should be, or no entry at all. One root cause — nothing asserts the document is well-formed — and one fix that closes all three. `apps/api` only; no runtime behavior changes.

Re-audited on this branch @ `2057f4b4`, reproducing the issue exactly: **139 documented operations, 98 `$ref`s of which 10 dangle, 3 operations with no `responses`, 105 registered component schemas.**

## Current shape

| Piece | Location | Note |
|---|---|---|
| The 3 `responses`-less routes | `file-uploads.router.ts:237` · `google-sheets-connector.router.ts:325` · `microsoft-excel-connector.router.ts:411` | Each block ends at the `colEnd` parameter — verified |
| The payload all 3 return | `apps/api/src/utils/workbook-preview.util.ts:126` | `SliceResult` — a plain TS interface, `cells: (string \| number \| null)[][]` |
| `SliceResult` consumers | `workbook-preview.util.ts:140,256` · `google-sheets-connector.service.ts:461` · `microsoft-excel-connector.service.ts:368` | Three services return it; nothing pins them to one shape |
| Component registration | `swagger.config.ts:345` (`components`), `:421` (`ApiErrorResponse`) | 59 entries come from `z.toJSONSchema(…, JSON_SCHEMA_OPTS)`; `ApiErrorResponse` is the lone hand-authored one |
| The 10 dangling `$ref`s | 9 have a source Zod schema in `packages/core/src/contracts/` | Only `ConnectorInstanceListResponse` differs, and only in name: the schema is `ConnectorInstanceListResponsePayloadSchema` (`connector-instance.contract.ts:90`) |
| The 7 undocumented routes | `entity-record.router.ts` (4 of 9) · `admin.router.ts` (1 of 2) · `portal-results.router.ts` (1 of 6) · `portal.router.ts` (1 of 8) | `swagger.router.ts` (2) is excluded by design — it serves the spec |
| Where the guard test goes | `apps/api/src/__tests__/config/swagger.config.test.ts` (534 lines) | **Already exists** — per-feature `describe` blocks over `swaggerSpec`. No new harness |

## Decision — `SliceResult` becomes a Zod contract, and the guard test is count-based for routes

**`SliceResult` is promoted to Zod, not hand-authored as JSON Schema.** Hand-authoring in `swagger.config.ts` (the `ApiErrorResponse` precedent) is cheaper but leaves the TS interface and the documented shape free to drift — which is the issue's own complaint about these three routes. So `SliceResultSchema` lands in `packages/core/src/contracts/spreadsheet-parsing.contract.ts` (the neutral home; all three surfaces are spreadsheet connectors), `workbook-preview.util.ts` re-derives `SliceResult` as `z.infer<typeof SliceResultSchema>`, and the component is registered with `z.toJSONSchema` like the other 59. One source of truth, and the three routes can no longer disagree.

**The 10 dangling `$ref`s are registered, not rewritten.** All 10 resolve to an existing schema, so each is a one-line `z.toJSONSchema` entry — `ConnectorInstanceListResponse` maps to `ConnectorInstanceListResponsePayloadSchema`. Registering keeps the route annotations untouched, which is the smaller diff and the shape the route authors intended.

**The route-parity assertion counts per file rather than matching paths.** Asserting "every registered Express route appears in `spec.paths`" path-by-path means booting the app and walking `app._router.stack`; no test in `apps/api` imports the app today, and doing it here drags env/DB setup into a docs test. Instead the guard reads `src/routes/*.ts` and asserts route-registration count equals `@openapi`-block count per file, with `swagger.router.ts` allow-listed and its reason in-file. That is exactly the audit the issue shipped as bash, it needs no boot, and it fails on the real defect — a route added without a block. It cannot catch a block whose *path string* is wrong, which the two existing `describe`s already spot-check per feature.

## Plan — 3 slices

**Slice 1 — the guard test, failing.** Add a `describe("swagger spec — document completeness (#420)")` to `apps/api/src/__tests__/config/swagger.config.test.ts` with three cases: every operation declares a non-empty `responses`; every `$ref` resolves against the document; per-router route/`@openapi` parity with `swagger.router.ts` allow-listed. *Tests:* `cd apps/api && npm run test:unit` — expect 3 failures naming the 3 routes, the 10 refs, and the 4 routers.

**Slice 2 — register the components.** *Files:* `packages/core/src/contracts/spreadsheet-parsing.contract.ts` (add `SliceResultSchema`), `apps/api/src/utils/workbook-preview.util.ts` (`SliceResult` becomes the inferred type), `apps/api/src/config/swagger.config.ts` (11 entries: `SliceResult` + the 10 dangling). *Tests:* the `$ref` case goes green; `npm run type-check` confirms the inferred type still satisfies all three services.

**Slice 3 — write the missing annotations.** `responses:` for the 3 sheet-slice routes (`200` → `SliceResult`; `400` and `404` on all three; `403` on the two connector routes — **not** `409 MICROSOFT_EXCEL_NO_ONEDRIVE`, since `sheetSlice` is cache-only per `microsoft-excel-connector.service.ts:361-380`), plus `@openapi` blocks for the 7 undocumented routes. Read each handler's actual throw paths before writing its status list. *Tests:* remaining 2 cases go green; full `npm run test:unit` + `npm run lint` + `npm run type-check`.

## Smoke (manual, against your dev stack)

1. `npm run dev`, open `http://localhost:3001/api/docs`. The three `sheet-slice` endpoints now show a `200` with a `cells` / `rowStart` / `colStart` payload and their error statuses.
2. Exercise one for real: draw a region in a file-upload or Google-Sheets workbook so the UI calls `sheet-slice`, and confirm the response body matches the documented shape field-for-field.
3. In Swagger UI, open a connector-instance endpoint and a REST-API `preview-endpoint-page` / `suggest-transform` endpoint — the previously-empty schema boxes now render real fields.
4. `curl -s localhost:3001/api/docs/spec | jq '[paths[][] | select(.responses == null)] | length'` → `0`.
5. Spot-check the 7 newly-documented routes in Swagger UI (4 under Entity Records, 1 each under Admin, Portal Results, Portals) — each has a summary, tag, security scheme and responses.
6. Prove the guard bites: delete a `responses:` block from any route, `cd apps/api && npm run test:unit` fails naming that operation; restore it.

## Out of scope

- **Changing `SliceResult`'s shape** or any handler behavior — the promotion to Zod is type-preserving.
- **The three routes' query-parameter declarations**, already complete and correct.
- **Path-string verification** of `@openapi` blocks (see Decision) and **auditing other documents** for the same class of defect.
- **`swagger.router.ts`'s own 2 routes** — the spec-serving endpoints, excluded by design with the reason recorded in the allow-list.
