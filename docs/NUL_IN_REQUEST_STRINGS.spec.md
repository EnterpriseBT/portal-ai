# NUL in request strings — Spec

**Issue:** [EnterpriseBT/portal-ai#805](https://github.com/EnterpriseBT/portal-ai/issues/805) · **Discovery:** `docs/NUL_IN_REQUEST_STRINGS.discovery.md`

This spec pins how U+0000 is kept away from Postgres on every path that can carry it.
- **HTTP requests** are refused with one typed 400 at the boundary.
- **Agent tool input** is refused with a typed, uncharged tool result.
- **Imported and synced data** has the character stripped at ingest, and the job that writes it reports a count.
- **Assistant messages** have it stripped before they're persisted.

## Key decisions (flag for review)

1. **HTTP: reject at one boundary middleware** (discovery D1-B), mounted after `jsonBodyOnly`. It covers JSON bodies, route params and query strings, for public and protected routes alike, before auth. No per-contract `.refine` (D2).
2. **Only U+0000** (D3). Every other character, including tab, newline and other C0 controls, passes.
3. **Imports and syncs strip; they don't reject** (D4a). The strip happens **at ingest** (D4b): in the workbook-cache `SessionWriter`, in Google Sheets' sync fetch (which bypasses that cache), and at REST sync's two record entry points. Headers, labels, source ids, previews and records then all agree.
   - *Correction to discovery:* REST sync doesn't use `importRows` (only `demo-seed.service.ts` does), so its strip sits in `rest-api.adapter.ts` instead.
4. **The count is `nulStrippedValues`.** It is the number of strings (cells, keys or values) that contained U+0000. It appears on the `connector_sync` and `layout_plan_commit` job results only when nonzero. `JobDetail` already renders the whole `result` as JSON (`apps/web/src/views/JobDetail.view.tsx:176–182`), so **no web change**. *Correction to discovery,* which expected a dedicated `JobDetail` line.
5. **Tool input: reject in a new gate applied *outside* the cost gate.** `wrapWithCostGate` charges any result that resolves (`cost-gate.service.ts:327–366` never inspects `result`), so the refusal must return before admission. Custom (webhook) tools are exempt.
6. **Assistant message blocks are stripped silently, with a log line.** It's model output, so there's no caller to reject back to, and no surface beyond the log. That covers a custom tool's result, which is stored inside the assistant's blocks.
7. **Source ids that differ only by a NUL merge** after stripping (discovery Q4, accepted).

## Scope

### In scope

1. `ApiCode.REQUEST_INVALID_CHARACTERS` and `ApiCode.TOOL_INPUT_INVALID_CHARACTERS`.
2. `utils/nul-character.util.ts`: `findNul`, `stripNul`, `stripNulDeep`.
3. `middleware/reject-nul.middleware.ts` (`rejectNul`), mounted in `app.ts`.
4. Stripping in `WorkbookCacheService`'s session writer, with the count on `SessionMeta`.
5. Stripping in `GoogleSheetsConnectorService.fetchWorkbookForSync`. Both sync fetches return the count.
6. Stripping at REST sync's record entry points, with the count summed into the sync result.
7. `nulStrippedValues` on `ConnectorSyncResultSchema`, `LayoutPlanCommitJobResultSchema` and `SyncInstanceResult`.
8. `services/input-character-gate.service.ts` (`wrapWithInputCharacterGate`), wired in `ToolService.buildAnalyticsTools`.
9. `stripNulDeep` on assistant blocks at both `portalMessages.create` sites in `portal.service.ts`.
10. Rewriting the #687 field-mapping test that used `%00` to force a DB error.

### Out of scope

- Other control or invisible characters (zero-width, bidi), which are a content policy question.
- The routes' blanket `catch → 500` wrapping.
- `importRows` (`services/record-import.util.ts`). Its only caller is demo seeding from fixture files.
- The webhook router (`app.ts:66`), which is Stripe, HMAC-verified, and mounted before the middleware.
- A dedicated `JobDetail` UI for the count.
- The pre-existing comment/code mismatch on permission-vs-cost gate order (`tools.service.ts:931–933` vs the actual wrap order). It's noted for a follow-up, not changed here.

## Surface

### Error codes — `apps/api/src/constants/api-codes.constants.ts`

In the request-lifecycle block (after `REQUEST_UNSUPPORTED_MEDIA_TYPE`, `:30`):

```ts
/** A request URL or JSON body carrying U+0000, which no Postgres text or
 *  jsonb value can store (#805). Refused before any route runs. 400. */
REQUEST_INVALID_CHARACTERS = "REQUEST_INVALID_CHARACTERS",
```

In the tool-gate group (after `TOOL_WRITE_BUSY`, `:805`):

```ts
/** A built-in tool's input carrying U+0000 (#805). Typed tool result; the
 *  tool never runs and the call is never charged. */
TOOL_INPUT_INVALID_CHARACTERS = "TOOL_INPUT_INVALID_CHARACTERS",
```

### `apps/api/src/utils/nul-character.util.ts` (new)

```ts
/** Longest JSON path echoed in a refusal; longer paths are cut with "…". */
export const MAX_NUL_PATH_LENGTH = 200;

/** Where the first U+0000 sits in a JSON-shaped value, or null if none.
 *  Checks object keys and string values, through objects and arrays,
 *  iteratively (no recursion, so depth can't overflow the stack). Path
 *  segments join with "." (`data.notes`, `items.2.name`), matching
 *  `describeFirstZodIssue`; a NUL in a key reports the key's parent path
 *  plus the stripped key. "" means the value itself is the string. */
export function findNul(value: unknown): { path: string } | null;

/** `s` without any U+0000. */
export function stripNul(s: string): string;

/** A copy of `value` with U+0000 removed from every key and string, and how
 *  many strings changed. Returns `value` itself (same reference) and 0 when
 *  `findNul(value)` is null, so the clean path allocates nothing. Non-plain
 *  values (Date, Buffer) pass through untouched. */
export function stripNulDeep<T>(value: T): { value: T; stripped: number };
```

If stripping makes two keys of one object collide (`"a\u0000"` and `"a"`), the later key in iteration order wins. This is the same rule as D-7's source-id merge.

### `apps/api/src/middleware/reject-nul.middleware.ts` (new)

```ts
export const rejectNul = (req: Request, _res: Response, next: NextFunction): void;
```

- **URL:** if `req.originalUrl.includes("%00")`, call `next(new ApiError(400, ApiCode.REQUEST_INVALID_CHARACTERS, "The request URL contains a NUL character (%00), which can't be stored", { location: "url" }))`. A literal NUL can't appear in a URL (Node's HTTP parser refuses it), and `%2500` decodes to the text `%00`, not a NUL. So this test is exact for both path and query.
- **Body:** if `req.body !== undefined` and `findNul(req.body)` returns a hit, call `next(new ApiError(400, ApiCode.REQUEST_INVALID_CHARACTERS, message, { location: "body", path }))`, where `message` is:
  - `` `${path}` contains a NUL character (U+0000), which can't be stored`` when `path !== ""`;
  - `The request body contains a NUL character (U+0000), which can't be stored` otherwise.

  `path` is capped at `MAX_NUL_PATH_LENGTH`. The value itself is never echoed.
- Otherwise, `next()`.
- Applies to every method. It's logged through the catch-all's standard `ApiError` branch (`app.ts:145`), like every 4xx.

**Mount** in `apps/api/src/app.ts`, directly after `app.use(jsonBodyOnly)` (`:90`) and before `/api/docs`, with a `// #805:` comment.

### Base64 filters — `apps/api/src/utils/filter-sql.util.ts`

*Added during slice 2.* The record list's `?filters=` carries a base64-encoded JSON expression, so a NUL inside it never appears as `%00` and gets past the URL check. `parseFilterPayload` (its only decoder, used by `entity-record.router.ts` and `portal-sql.service.ts`) runs `findNul` on the decoded value before schema validation. On a hit it returns the `FilterValidationError` `` Invalid filter: `<path>` contains a NUL character (U+0000), which can't be stored `` ("the expression" in place of the path at the root). The route answers that with its existing `400 ENTITY_RECORD_INVALID_FILTER`.

### Workbook cache — `apps/api/src/services/workbook-cache.service.ts`

- `SessionMeta` (`:36`) gains `nulStrippedValues?: number`. It's absent when zero.
- The `SessionWriter` returned by `beginSession` (`:103`) changes in three places:
  - `appendRows` replaces each string `ChunkCell` with `stripNul(cell)` when it contains U+0000, and increments a per-session counter.
  - `finishSheet` strips `info.name` the same way, and counts it.
  - `finalize("ready")` writes `nulStrippedValues` into the meta when the counter is > 0.

  The `SessionWriter` interface (`:66–83`) is unchanged.

*Added during slice 3:* `sheetId()` (`utils/workbook-preview.util.ts:46`) also strips U+0000 from the name it slugs. Every pipeline derives the sheet id from the raw name before the writer sees it, and the id is stored in layout plans (jsonb).

This covers file-upload parse and its S3 re-stream, the Google Sheets editor session (`google-sheets-connector.service.ts:230, :354`), the Excel editor session (`microsoft-excel-connector.service.ts:331, :541`) and Excel sync's throwaway session (`:657`).

### Sync fetches

- `GoogleSheetsConnectorService.fetchWorkbookForSync` (`google-sheets-connector.service.ts:388`) strips the fetched `WorkbookData` before calling `makeWorkbook`. It strips each sheet `name`, each string `cell.value` and each `cell.rawText`, counting strings that changed.
- `MicrosoftExcelConnectorService.fetchWorkbookForSync` (`microsoft-excel-connector.service.ts:571`) reads the count from the throwaway session's `meta.nulStrippedValues` (`:689`).
- Both now return `Promise<{ workbook: Workbook; nulStrippedValues: number }>`. Their one caller each (`google-sheets.adapter.ts:123`, `microsoft-excel.adapter.ts:126`) destructures the result. Each adapter puts the count on its result next to `mirrorDegraded` (`:199` / `:202`), as `...(n > 0 ? { nulStrippedValues: n } : {})`.

### Layout-plan commit — `apps/api/src/services/layout-plan-draft.service.ts`

```ts
/** U+0000 strings the source's cached session had stripped (0 when none or
 *  when the session is gone). Read after `resolveWorkbookBySource`, which
 *  may have re-streamed the session from S3. */
static async nulStrippedValuesForSource(
  source: LayoutPlanCommitWorkbookSource
): Promise<number>;
```

- It derives the prefix the way each resolver already does: `uploadSessionCachePrefix(uploadSessionId)`, or `workbookCacheKey(slug, connectorInstanceId)` for google-sheets / microsoft-excel. `uploadSessionCachePrefix` is exported from `file-upload-session.service.ts` for this. No organization id is taken: the source was already resolved, and authorized, by `resolveWorkbookBySource`. It then reads `WorkbookCacheService.getSessionMeta(prefix)?.nulStrippedValues ?? 0`.
- The commit result (`:349–353`) and the recommit result (`:552–556`) add `...(n > 0 ? { nulStrippedValues: n } : {})`. `resolveWorkbookBySource`'s signature is unchanged.

### REST sync — `apps/api/src/adapters/rest-api/rest-api.adapter.ts`

- Both record entry points replace `{ ...(record as Record<string, unknown>) }` with `stripNulDeep(record)`, then spread the result. These are the streaming `add` (`~:854`) and the per-record path (`~:987`). Stripping happens **before** `deriveSourceId` and `checksumRecord`, so an unchanged remote row containing a NUL stays `unchanged` across syncs.
- `stripped` adds into `ctx.counts.nulStrippedValues`.
- `syncOneEndpoint`'s return (`:608–617`) gains `nulStrippedValues`. The adapter sums it across endpoints next to `mirrorDegraded` (`:303`) and puts it on the result (`:341`) when > 0.

### Result schemas

- `packages/core/src/models/job.model.ts`: `ConnectorSyncResultSchema` (`:185–219`, beside `mirrorDegraded` at `:209`) and `LayoutPlanCommitJobResultSchema` (`:335–346`) each gain:

  ```ts
  /** Strings whose U+0000 was stripped on ingest, which Postgres can't
   *  store (#805). Absent when none. */
  nulStrippedValues: z.number().int().positive().optional(),
  ```

- `apps/api/src/adapters/adapter.interface.ts`: `SyncInstanceResult` (`:39`, beside `mirrorDegraded?` at `:69`) gains `nulStrippedValues?: number`. `connector-sync.processor.ts` passes it through unchanged (`:148–160`).

### Tool input gate — `apps/api/src/services/input-character-gate.service.ts` (new)

```ts
export function wrapWithInputCharacterGate(
  tools: Record<string, GateableTool>,
  isCustom: (toolName: string) => boolean
): void;
```

- For every tool with an `execute` where `!isCustom(name)`, it wraps `execute`. If `findNul(input)` hits, it returns the result below without calling `original`. Otherwise it delegates.

  ```ts
  { error: { code: ApiCode.TOOL_INPUT_INVALID_CHARACTERS,
             message: `Tool input${path ? ` at \`${path}\`` : ""} contains a NUL character (U+0000), which can't be stored. Retry without it.`,
             path } }
  ```

  This matches the existing `{ error: { code, message, … } }` refusal shape (`lockRefusal`, `permissionDenied`, the cost gate's `deny`).
- **Wiring:** in `ToolService.buildAnalyticsTools` (`tools.service.ts`), call it **immediately after `wrapWithCostGate`** (`:945`) and before the model-output cap (`:983`). It reuses `customToolNames.has(name)`. The gate is then outside the cost gate, so a refused call never reaches `checkAdmission` and is never charged. A comment records why.

### Assistant messages — `apps/api/src/services/portal.service.ts`

- Before `repo.portalMessages.create` in `streamResponse` (`:815`), set `assistantBlocks = stripNulDeep(assistantBlocks).value`. Do the same for the blocks in `notifyJobTerminal` (`:588`).
- When `stripped > 0`, log at `warn` with `{ portalId, stripped }`. The text is never logged.
- The user turn (`addMessage`, `:486`) arrives over HTTP, so the middleware already covers it.

### Code-review amendments

The PR's code review changed four things after the slices landed:

- **Commit count:** `nulStrippedValuesForSource` is read right after `resolveWorkbookBySource`, **before** the commit, in both commit and recommit. After the commit, `markSessionCommitted` deletes an upload session in the background, and a throw there would fail a commit that had already landed. It's also best-effort: a failed read logs and answers 0.
- **Bulk transform:** `transform_entity_records` writes tool results into the target's wide table, and a custom tool's output can carry U+0000. `dispatchBatch` (`queues/processors/bulk-transform-tool.dispatcher.ts`) strips every success value. `DispatchResult.nulStrippedValues` sums it, and `BulkTransformResultSchema` gains the same optional positive `nulStrippedValues`.
- **Webhook staging:** `POST /api/webhook/handle/:sessionId` carries a custom webhook's result rows, which are org-hosted tool output staged in Redis. `rejectNul` skips that route's body (its URL is still checked), and the route strips `rows` and `schema` with `stripNulDeep`.
- **Google Sheets count:** `fetchWorkbookForSync` strips the freshly mapped `WorkbookData` in place (`stripNulFromWorkbookData`), counting each sheet name and each cell once, as the cache writer does. `findNul` builds its path only on a hit, and visits keys and values strictly in document order.

## Migration / Seed

None. There's no schema change: `nulStrippedValues` lives in the existing `jobs.result` jsonb and in Redis session meta.

## TDD test plan

Run per package with the npm scripts:
- `cd apps/api && npm run test:unit` and `npm run test:integration`
- `cd packages/core && npm run test:unit`

### api — `__tests__/utils/nul-character.util.test.ts` (new)

1. `findNul` hits a top-level string value (path `name`), a nested value (`data.notes`), an array element (`items.2`), a key (`data.k`), and a root string (`""`).
2. `findNul` returns null for clean input. It returns null for the 6-character text `\u0000` (an escaped backslash in JSON), and for tab, newline and U+0001.
3. `findNul` on a 10,000-deep nested object doesn't throw (it's iterative).
4. `stripNul` removes every U+0000.
5. `stripNulDeep` on clean input returns the same reference and `stripped: 0`. On dirty input it returns a stripped copy, leaves the original untouched, counts keys and values, and passes Date through.
6. A path longer than `MAX_NUL_PATH_LENGTH` is cut.

### api — `__tests__/middleware/reject-nul.middleware.test.ts` (new; `makeApp()` + supertest, as `json-body-only.middleware.test.ts`)

7. A NUL in a body value gives 400 `REQUEST_INVALID_CHARACTERS`, with `details { location: "body", path: "name" }` and the message naming `name`.
8. Nested values, array elements and keys work the same way. A root string body gets the bodyless message.
9. `%00` in the path and in the query give 400 with `location: "url"`. `%2500` passes.
10. A clean body or URL passes through to the route. A GET with no body passes.
11. The response never contains the offending value.

### api — integration (`npm run test:integration`)

12. `__integration__/app.integration.test.ts`, next to "Body-parser error mapping": a POST to `/nonexistent` with a NUL body gives 400 `REQUEST_INVALID_CHARACTERS` without auth. `GET /api/health?x=%00` gives 400.
13. `__integration__/routes/station.router.integration.test.ts`: `POST /api/stations` with `name: "Ops\u0000x"` gives 400, and the station count is unchanged.
14. `__integration__/routes/entity-record.router.integration.test.ts`: a create whose `normalizedData` value contains a NUL gives 400 and no record row is written. A list `?search=%00` gives 400 instead of 500. A base64 filter whose value contains a NUL gives 400 `ENTITY_RECORD_INVALID_FILTER` naming `conditions.0.value`. `__tests__/utils/filter-sql.util.test.ts` covers `parseFilterPayload` directly.
15. `__integration__/routes/field-mapping.router.integration.test.ts:500–517` (#687) is rewritten. `jest.spyOn` makes the repository read reject with a Drizzle-shaped error whose message carries SQL text. The test still asserts 500 `FIELD_MAPPING_FETCH_FAILED`, `Internal server error`, and no SQL in the body. A new case asserts `/api/field-mappings/%00` gives 400 `REQUEST_INVALID_CHARACTERS`.

### api — ingest

16. `__tests__/services/workbook-cache.service.test.ts`: `appendRows` with a NUL string cell stores it stripped. Numbers, booleans and nulls are untouched. `finishSheet` strips the sheet name. `finalize` writes `nulStrippedValues: <n>`, and it's absent when clean.
17. `__tests__/services/google-sheets-connector.service.test.ts`: `fetchWorkbookForSync` with a NUL in a cell, its `rawText` and a sheet name returns a stripped workbook and the right count.
18. `__tests__/services/microsoft-excel-connector.service.fetchWorkbookForSync.test.ts`: it returns `{ workbook, nulStrippedValues }` from the throwaway session's meta.
19. `__tests__/adapters/rest-api/rest-api.adapter.test.ts`, covering both the streaming and per-record paths:
    - A record with a NUL in a nested value and in its id field is written stripped.
    - `sourceId` is derived from the stripped value.
    - The result carries `nulStrippedValues`.
    - Re-syncing the same remote payload reports the record `unchanged`.
    - Clean records give no field.
20. Google Sheets and Excel adapter tests: the sync result carries `nulStrippedValues` when the fetch reports it, and omits it when it's zero.
21. Layout-plan-draft commit and recommit: the result carries `nulStrippedValues` from session meta (via `nulStrippedValuesForSource`), and omits it when it's zero.
22. `__tests__/queues/processors/connector-sync.processor.test.ts`: `nulStrippedValues` passes through to the job result.

### api — tool gate (`__tests__/services/tools.service.test.ts` + new `__tests__/services/input-character-gate.service.test.ts`)

23. The gate returns the typed refusal for NUL input, with `path` set, and `original` is not called. Clean input delegates.
24. A custom tool's NUL input is delegated, not refused.
25. Guard, beside the cost-gate guard at `tools.service.test.ts:970`:
    - Every built-in tool called with NUL input returns `TOOL_INPUT_INVALID_CHARACTERS`.
    - `CostGateService.checkAdmission` is never called.
    - The usage charge spy is untouched.

### api — portal

26. `__tests__/services/portal.service.test.ts`: an assistant turn whose text block or tool-result block contains a NUL is persisted stripped, and the warn log carries the count.
27. `__tests__/services/portal.service.notify-job-terminal.test.ts`: same for the job-terminal message.

### core — `__tests__/models/job.model.test.ts`

28. `ConnectorSyncResultSchema` and `LayoutPlanCommitJobResultSchema` accept `nulStrippedValues: 3`, accept its absence, and reject `0` and `-1`.

**Totals ≈ 45 cases** (≈ 6 util, 6 middleware, 8 integration, 12 ingest, 5 tool gate, 3 portal, 3 core, plus the #687 rewrite).

## Acceptance criteria

- [ ] `POST /api/stations` with a NUL in `name` gives `400 REQUEST_INVALID_CHARACTERS` naming `name`, and no station is created.
- [ ] A NUL in any JSON body value or key, in a route param or in a query string gives that 400 on every route, including list `?search=` reads that used to 500.
- [ ] Clean requests behave exactly as before. A tab, a newline, or the escaped text `\u0000` is accepted.
- [ ] A CSV/XLSX upload, a Google Sheets or Excel import or sync, or a REST sync whose data contains U+0000 completes. The data is stored without the character, and the job's `result` carries `nulStrippedValues`, visible in `JobDetail`.
- [ ] A REST record that contains a NUL and hasn't changed upstream is reported `unchanged` on the next sync.
- [ ] An agent tool call with a NUL in its input returns a typed `TOOL_INPUT_INVALID_CHARACTERS` result the agent can act on. The tool doesn't run and usage isn't charged.
- [ ] An assistant reply or custom-tool result that contains U+0000 persists (stripped) instead of failing the turn.
- [ ] `npm run build`, `npm run type-check`, `npm run lint` and `npm run format:check` are clean at the repo root.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| The middleware refuses a request some client legitimately sends | Postgres can't store U+0000 on any path, so every refused request would have failed anyway. The one exception is a route that never writes or queries the value; none is known. |
| A literal `\u0000` *text* (escaped backslash) gets refused | Cases 2 and 7–8 assert the escaped form passes. The check runs on parsed values, never on raw bytes. |
| The body walk is slow on a 4 MiB body | It's one linear pass over values already in memory. Case 3 covers depth. |
| The tool gate ends up inside the cost gate, so refusals get charged | Wiring order is fixed after `wrapWithCostGate`, and the guard (case 25) asserts `checkAdmission` is never called. |
| Stripping changes customer data silently | The count lands on the job result. Strings are the only values touched, and U+0000 carries no meaning in a text cell. |
| Stripping merges two source ids | Accepted (D-7). Those rows fail the whole import today. |
| The #687 test loses its DB-error trigger | It's rewritten to a repository spy (case 15), so the no-SQL-leak assertion survives. |

**Fail mode:** HTTP and tool input fail closed (refused before any write). Imports fail soft (stripped and counted).

**Rollback:** `git revert`. There's no migration and no persisted shape that old code can't read: `nulStrippedValues` is an optional result field, and old readers ignore it.

## Files touched

**`apps/api`:**
- New:
  - `utils/nul-character.util.ts`
  - `middleware/reject-nul.middleware.ts`
  - `services/input-character-gate.service.ts`
  - tests `__tests__/utils/nul-character.util.test.ts`, `__tests__/middleware/reject-nul.middleware.test.ts`, `__tests__/services/input-character-gate.service.test.ts`
- Edit:
  - `constants/api-codes.constants.ts`, `app.ts`
  - `services/workbook-cache.service.ts`, `services/google-sheets-connector.service.ts`, `services/microsoft-excel-connector.service.ts`
  - `adapters/google-sheets/google-sheets.adapter.ts`, `adapters/microsoft-excel/microsoft-excel.adapter.ts`, `adapters/rest-api/rest-api.adapter.ts`, `adapters/adapter.interface.ts`
  - `services/layout-plan-draft.service.ts`, `services/tools.service.ts`, `services/portal.service.ts`
  - the test files named in the plan above, including `field-mapping.router.integration.test.ts`

**`packages/core`:** edit `models/job.model.ts` and `__tests__/models/job.model.test.ts`.

**`apps/web`:** none.

No new dependency, env var or infra change.

**Docs:**
- `apps/api/README.md`: the request-pipeline order, if it lists middleware.
- `CLAUDE.md` (and `.github/copilot-instructions.md`): a sentence in the API Style Guide's request-validation bullet, saying a NUL is refused at the boundary with `REQUEST_INVALID_CHARACTERS`, and that ingest strips it.

## Next step

`/plan 805` writes `docs/NUL_IN_REQUEST_STRINGS.plan.md` in five TDD slices, each a commit on this branch:
1. The codes + `nul-character.util.ts`.
2. The middleware + mount + integration tests + the #687 rewrite.
3. Workbook ingest (session writer, both sync fetches, commit/sync result counts, core schemas).
4. REST sync strip + count.
5. The tool input gate + guard, the assistant-message strip, and the docs.
