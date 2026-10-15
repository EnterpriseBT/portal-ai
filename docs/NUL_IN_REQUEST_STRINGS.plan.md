# NUL in request strings — Plan

**This plan implements the spec in TDD order:**
1. The shared NUL helpers.
2. The boundary middleware that refuses U+0000 in HTTP requests.
3. The ingest strip and counts for spreadsheet and REST data.
4. The tool-input gate outside the cost gate.
5. The assistant-message strip.

Spec: `docs/NUL_IN_REQUEST_STRINGS.spec.md`. Discovery: `docs/NUL_IN_REQUEST_STRINGS.discovery.md`. Issue: #805.

There are seven slices. Each sits behind a green test suite and leaves the repo compilable. They land as **commits on `fix/805-nul-in-request-strings`**: one fix, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package. Never invoke jest directly (`feedback_use_npm_test_scripts`); run only the touched files locally (`feedback_test_only_touched_files_locally`):

```bash
cd apps/api && npm run test:unit -- --testPathPattern <file>
cd apps/api && npm run test:integration -- --testPathPattern <file>
cd packages/core && npm run test:unit -- --testPathPattern job.model
```

Each slice follows the same loop:
1. Write the failing tests.
2. Make the smallest change that turns them green.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check` at the boundary, plus `npm run format`.
5. Move to the next slice.

**Sequencing rationale.** Leaf logic comes first, then the wiring, one entry path per slice:

- **Slice 1:** the codes and `nul-character.util.ts`, as pure functions. Every later slice imports them.
- **Slice 2:** the HTTP boundary. This is the bug as reported, so it closes the issue's repro on its own.
- **Slice 3:** the `nulStrippedValues` result field (core plus `SyncInstanceResult`), the session-writer strip and the layout-plan commit count. It covers file upload and the editor-session imports, and lands the field that slices 4–5 report into.
- **Slice 4:** the Google Sheets and Excel sync fetches and their adapters. These depend on slice 3's session strip (Excel sync) and its result field.
- **Slice 5:** REST sync. It's independent of the spreadsheet code but needs slice 3's field.
- **Slice 6:** the tool input gate and its guard. It needs slice 1's code and helpers.
- **Slice 7:** the assistant-message strip and the docs sweep. Docs go last so they describe what actually shipped.

No migration (spec → Migration / Seed).

---

## Slice 1 — codes + NUL helpers

These are pure helpers. Nothing calls them yet.

**Files**

- Edit: `apps/api/src/constants/api-codes.constants.ts`: add `REQUEST_INVALID_CHARACTERS` (after `:30`) and `TOOL_INPUT_INVALID_CHARACTERS` (after `:805`), each with its doc comment.
- New: `apps/api/src/utils/nul-character.util.ts`: `MAX_NUL_PATH_LENGTH`, `findNul`, `stripNul`, `stripNulDeep`.
- New: `apps/api/src/__tests__/utils/nul-character.util.test.ts`.

**Steps**

1. **Tests (spec cases 1–6).**
   - `findNul` paths: value, nested, array element, key, root string.
   - Clean inputs, including the escaped text `\u0000`, tab, newline and U+0001.
   - 10,000-deep nesting doesn't throw.
   - `stripNul`.
   - `stripNulDeep`: same reference when clean, a copy when dirty, the original untouched, keys and values counted, Date passed through, the key-collision rule.
   - Path cap.

   Run them and watch them fail.
2. **Implement** an iterative walk with an explicit stack of `{ value, path }`. `stripNulDeep` calls `findNul` first and returns early when it finds nothing. Green.
3. Lint + type-check.

**Done when:** cases 1–6 pass and nothing imports the util yet.

**Risk:** none. It's pure code.

---

## Slice 2 — boundary middleware + mount

Closes the issue's repro.

**Files**

- New: `apps/api/src/middleware/reject-nul.middleware.ts`: `rejectNul`.
- New: `apps/api/src/__tests__/middleware/reject-nul.middleware.test.ts`, using a `makeApp()` + supertest harness like `json-body-only.middleware.test.ts:19`.
- Edit: `apps/api/src/app.ts`: `app.use(rejectNul)` right after `app.use(jsonBodyOnly)` (`:90`), with a `// #805:` comment.
- Edit:
  - `apps/api/src/__tests__/__integration__/app.integration.test.ts`
  - `__integration__/routes/station.router.integration.test.ts`
  - `__integration__/routes/entity-record.router.integration.test.ts`
  - `__integration__/routes/field-mapping.router.integration.test.ts`

**Steps**

1. **Unit tests (spec cases 7–11).**
   - Body refusals carry `details { location, path }` and the message names the path.
   - A root string body gets the bodyless message.
   - URL refusals: `%00` in the path and in the query. `%2500` passes.
   - Clean requests pass through.
   - The offending value is never echoed.

   Run them and watch them fail.
2. **Implement** `rejectNul`. Unit green.
3. **Integration tests (spec cases 12–15).**
   - App level: a NUL body to `/nonexistent` is refused with no auth, and so is `GET /api/health?x=%00`.
   - Station create: 400 with nothing written.
   - Entity record: create with a NUL in `data` gives 400 and no row; `?search=%00` gives 400; a filter whose value contains a NUL gives 400.
   - **#687 rewrite:** make the field-mapping repository read reject with a Drizzle-shaped error carrying SQL text, using `jest.spyOn`. The test keeps its 500 `FIELD_MAPPING_FETCH_FAILED` / no-SQL assertions. A new case asserts `/api/field-mappings/%00` gives 400.

   Run them; the new cases fail until the mount exists, and the old #687 case starts failing once it does.
4. **Mount** in `app.ts`. Integration green.
5. Lint + type-check.

**Done when:**
- Cases 7–15 pass.
- `POST /api/stations` with a NUL name gives 400 `REQUEST_INVALID_CHARACTERS` against the dev stack.
- The #687 test still proves a DB failure leaks no SQL.

**Risk:**
- The #687 spy has to target the repository method the route actually calls. Read the route's fetch path first, so the 500 still comes from the route's own catch and not the catch-all's `UNKNOWN`.
- The full integration suite needs `STRIPE_*` exported here (project memory). Only run the touched files.

---

## Slice 3 — result field + session-writer strip + commit count

**Files**

- Edit: `packages/core/src/models/job.model.ts`: add `nulStrippedValues: z.number().int().positive().optional()` to `ConnectorSyncResultSchema` (`:185–219`) and `LayoutPlanCommitJobResultSchema` (`:335–346`).
- Edit: `packages/core/src/__tests__/models/job.model.test.ts`.
- Edit: `apps/api/src/adapters/adapter.interface.ts`: `SyncInstanceResult.nulStrippedValues?: number` (beside `:69`).
- Edit: `apps/api/src/services/workbook-cache.service.ts`:
  - `SessionMeta.nulStrippedValues?`.
  - Strip and count in `appendRows` / `finishSheet`.
  - Write the count in `finalize`.
- Edit: `apps/api/src/services/layout-plan-draft.service.ts`: `nulStrippedValuesForSource`, and the count on the commit (`:349–353`) and recommit (`:552–556`) results.
- Edit: `apps/api/src/__tests__/services/workbook-cache.service.test.ts`, plus the layout-plan-draft service test that covers commit/recommit results.

**Steps**

1. **Core tests (spec case 28).** Both schemas accept `3` and accept the field's absence, and reject `0` and `-1`. Fail, implement, green.
2. **Session tests (spec case 16).**
   - String cells are stored stripped.
   - Numbers, booleans and nulls are untouched.
   - The sheet name is stripped.
   - `finalize` meta carries the count, and the field is absent when clean.

   Fail, implement, green.
3. **Commit tests (spec case 21).** Mock `WorkbookCacheService.getSessionMeta` to return a count for the source's prefix. The commit and recommit results carry `nulStrippedValues`, and omit it when it's 0. Fail, implement `nulStrippedValuesForSource` (derived from `uploadSessionCachePrefix` / `workbookCacheKey`), green.
4. Lint + type-check, and **run the root `npm run build`**. A core model field ripples into typed fixtures in web and site, and a per-package type-check misses that (project memory).

**Done when:**
- Cases 16, 21 and 28 pass.
- A file upload whose CSV contains a NUL commits, and the commit job's result shows `nulStrippedValues`.

**Risk:**
- The session counter has to live in the `beginSession` closure, per session, not at module level, because concurrent sessions run in one process.
- Read the count *after* `resolveWorkbookBySource`, since a cache miss re-streams the upload session from S3 under the same prefix.

---

## Slice 4 — spreadsheet sync fetches + adapters

**Files**

- Edit: `apps/api/src/services/google-sheets-connector.service.ts`: `fetchWorkbookForSync` (`:388`) strips the `WorkbookData` (sheet names, string `value`, `rawText`) before `makeWorkbook`, and returns `{ workbook, nulStrippedValues }`.
- Edit: `apps/api/src/services/microsoft-excel-connector.service.ts`: `fetchWorkbookForSync` (`:571`) returns `{ workbook, nulStrippedValues: meta.nulStrippedValues ?? 0 }`.
- Edit: `apps/api/src/adapters/google-sheets/google-sheets.adapter.ts` (`:123`, `:199`) and `adapters/microsoft-excel/microsoft-excel.adapter.ts` (`:126`, `:202`): destructure the fetch result and set the count on the result.
- Edit:
  - `__tests__/services/google-sheets-connector.service.test.ts`
  - `__tests__/services/microsoft-excel-connector.service.fetchWorkbookForSync.test.ts`
  - the two adapter tests
  - `__tests__/queues/processors/connector-sync.processor.test.ts`

**Steps**

1. **Tests (spec cases 17, 18, 20, 22).**
   - The Google Sheets fetch strips a cell, its `rawText` and a sheet name, and returns the count.
   - The Excel fetch returns the meta count.
   - Each adapter puts the count on its result, and omits it at 0.
   - The processor passes it through to the job result.

   Fail.
2. **Implement.** Change the two fetch return types and update the one caller each. Update the existing mocks of `fetchWorkbookForSync` in the adapter tests to the new shape. Green.
3. Lint + type-check.

**Done when:** cases 17, 18, 20 and 22 pass, and a Google Sheets or Excel sync whose source holds a NUL completes with the count on its job result.

**Risk:** existing tests that mock `fetchWorkbookForSync` return a bare `Workbook`. `type-check` finds every one that needs the new shape.

---

## Slice 5 — REST sync strip + count

**Files**

- Edit: `apps/api/src/adapters/rest-api/rest-api.adapter.ts`:
  - Both record entry points (streaming `add`, `~:854`; per-record, `~:987`) use `stripNulDeep(record)` in place of the `{ ...record }` spread, before `deriveSourceId` / `checksumRecord`.
  - `ctx.counts.nulStrippedValues`.
  - `syncOneEndpoint`'s return (`:608–617`).
  - The adapter-level sum (`:303`) and the result (`:341`).
- Edit: `apps/api/src/__tests__/adapters/rest-api/rest-api.adapter.test.ts`.

**Steps**

1. **Tests (spec case 19), for both the streaming and per-record paths.**
   - A record with a NUL in a nested value and in its id field is written stripped.
   - `sourceId` is derived from the stripped value.
   - The result carries `nulStrippedValues`.
   - A re-sync of the same payload reports the record `unchanged`.
   - Clean records give no field.

   Fail.
2. **Implement.** Keep the top-level spread's purpose: `stripNulDeep` must still return a plain object with `Object.prototype` (see the null-prototype comment at `~:975`). Spread its `value` when it's returned unchanged. Green.
3. Lint + type-check.

**Done when:** case 19 passes on both paths.

**Risk:** `stripNulDeep`'s copy must not reintroduce null-prototype sub-objects. Build copies with `{}`, and add a test with an `Object.create(null)` input.

---

## Slice 6 — tool input gate

**Files**

- New: `apps/api/src/services/input-character-gate.service.ts`: `wrapWithInputCharacterGate(tools, isCustom)`.
- New: `apps/api/src/__tests__/services/input-character-gate.service.test.ts`.
- Edit: `apps/api/src/services/tools.service.ts`: call the gate right after `wrapWithCostGate` (`:945`) and before the model-output cap (`:983`), passing `(name) => customToolNames.has(name)`, with a comment on why it sits outside the cost gate.
- Edit: `apps/api/src/__tests__/services/tools.service.test.ts`: add the guard beside the cost-gate guard at `:970`.

**Steps**

1. **Unit tests (spec cases 23–24).** NUL input returns the typed refusal with `path`, and `original` is not called. Clean input delegates. A custom tool delegates even with NUL input. Fail, implement, green.
2. **Guard test (spec case 25).**
   - Every built-in tool called with NUL input returns `TOOL_INPUT_INVALID_CHARACTERS`.
   - `CostGateService.checkAdmission` is never called.
   - The usage charge spy is untouched.

   Fail, wire, green.
3. Lint + type-check.

**Done when:** cases 23–25 pass, and the existing gate guards (`:970`, `:1050`, `:1070`) stay green.

**Risk:** the `:1070` guard mocks the lock and permission gates and checks call order. The new gate must not disturb those mocks. It isn't mocked, so it wraps whatever `execute` the mocks leave in place.

---

## Slice 7 — assistant-message strip + docs

**Files**

- Edit: `apps/api/src/services/portal.service.ts`: run `stripNulDeep` on the blocks before `portalMessages.create` at `:815` (`streamResponse`) and `:588` (`notifyJobTerminal`), with a warn log `{ portalId, stripped }` when the count is > 0.
- Edit: `__tests__/services/portal.service.test.ts` and `__tests__/services/portal.service.notify-job-terminal.test.ts`.
- Edit (docs):
  - `CLAUDE.md` and `.github/copilot-instructions.md`: one sentence in the API Style Guide's request-validation bullet. A NUL is refused at the boundary with `REQUEST_INVALID_CHARACTERS` and refused in tool input with `TOOL_INPUT_INVALID_CHARACTERS`, while ingest strips it and counts `nulStrippedValues`.
  - `apps/api/README.md`: the middleware order, if the README lists it.

**Steps**

1. **Tests (spec cases 26–27).** An assistant text block and a tool-result block containing a NUL persist stripped, and the warn log carries the count. Same for the job-terminal message. Fail, implement, green.
2. **Docs.** Check the doc-sync table in `CLAUDE.md`. No tool description, help, glossary or sample content changes, since no user-visible capability changed beyond error copy.
3. Lint + type-check + `npm run format:check` at the root.

**Done when:**
- Cases 26–27 pass.
- The docs name both codes and the strip.
- The root `build`, `type-check`, `lint` and `format:check` are clean.

**Risk:** none.

---

## Sequence summary

| Slice | Lands | Spec cases | Gate |
|---|---|---|---|
| 1 | Codes + `nul-character.util.ts` | 1–6 | unit |
| 2 | `rejectNul` + mount + #687 rewrite | 7–15 | unit + integration |
| 3 | Result field, session strip, commit count | 16, 21, 28 | unit (api + core) + root build |
| 4 | Google Sheets/Excel sync fetches + adapters | 17, 18, 20, 22 | unit |
| 5 | REST sync strip + count | 19 | unit |
| 6 | Tool input gate + guard | 23–25 | unit |
| 7 | Assistant-message strip + docs | 26–27 | unit + root checks |

## Cross-slice notes

- **The issue's repro closes at slice 2.** Slices 3–7 are the folded-in Decision 4 and could ship as a follow-up commit series if the PR needs splitting. They stay on this branch by default.
- **`nulStrippedValues` is always "absent when zero"** on every result and on `SessionMeta`. Use one spread idiom (`...(n > 0 ? { nulStrippedValues: n } : {})`) so the core schema's `.positive()` never sees a 0.
- **Formatting:** the pre-commit hook runs lint-staged. Don't use `--no-verify`, because CI's `format:check` catches it anyway.
- **The PR body's merge gate:** this is a full-sized bug, so code-review, security (it touches request handling at the boundary), smoke and adversarial are all required.

## Next step

Implementation starts on `fix/805-nul-in-request-strings` with slice 1, tests first and one commit per slice, once you've confirmed the plan.
