# XLSX Workflow — TDD Implementation Plan

> Companion to `XLSX_WORKFLOW.spec.md` and `XLSX_WORKFLOW.discovery.md`. This plan breaks the spec into step-by-step TDD-ordered tasks.

## Context

The upload workflow currently only supports CSV files, and its CSV path is fully buffered (`Buffer.concat` in both the processor and import service). Before adding XLSX, we convert the CSV pipeline to streaming so that both formats share a memory-bounded model. XLSX is then added in parallel using `exceljs` (streaming `WorkbookReader`). This keeps peak memory constant per job as upload limits grow, without duplicating parse/import logic across formats.

This plan follows TDD: for each step, write failing tests first, then implement just enough to make them pass, then verify existing tests still pass.

The plan is organized in three phases:

- **Phase 1 (Streaming Refactor):** Extract shared utilities, convert CSV parse + import to streaming. No behavior change from the user's perspective; hot-path refactor that needs load validation.
- **Phase 2 (XLSX Support):** Add `exceljs`, implement XLSX parser/import service, route by extension, infra updates.
- **Phase 3 (Frontend Generalization):** Relabel, rename workflow, accept `.xlsx`.

---

# Phase 1 — Streaming Refactor

## Step 1 — Extract `column-stats.util.ts` (pure refactor)

**Goal:** Move the column statistics accumulator out of the processor into a shared util so all parsers can use it.

### 1a. Write tests: `apps/api/src/__tests__/utils/column-stats.util.test.ts`

```
describe("createAccumulator")
  - returns accumulator with name set, counters at zero, empty collections

describe("updateAccumulator")
  - increments totalCount per call
  - increments nullCount for empty/whitespace values
  - tracks unique values up to 1000 cap
  - updates minLength / maxLength
  - collects up to 10 sample values then stops

describe("finalizeAccumulator")
  - computes nullRate = nullCount / totalCount
  - converts Set<string> uniqueCount to number
  - returns ColumnStat shape matching Zod schema
  - handles zero-row accumulator (no division by zero)
```

### 1b. Implement: `apps/api/src/utils/column-stats.util.ts`

Extract `ColumnAccumulator`, `createAccumulator`, `updateAccumulator`, `finalizeAccumulator` from `apps/api/src/queues/processors/file-upload.processor.ts:63-124`.

### 1c. Update `file-upload.processor.ts`

Replace inline definitions with imports from `column-stats.util.ts`. No behavior change.

### 1d. Verify

```bash
cd apps/api && npx jest --testPathPattern="column-stats|file-upload.processor" --no-coverage
```

---

## Step 2 — Implement streaming `csv-parser.util.ts` (TDD)

**Goal:** Replace the buffered `parseCSVBuffer(buffer, delimiter)` with a streaming parser and a row iterator, both consuming `Readable` directly. No more full-file buffers.

### 2a. Write tests: `apps/api/src/__tests__/utils/csv-parser.util.test.ts`

```
describe("parseCsvStream")
  - streams a simple CSV and returns FileParseResult with headers + sample rows + stats
  - handles empty file (returns empty result shape, no throw)
  - handles header-only file (rowCount 0, headers set)
  - detects delimiter from the first 64 KB tap (comma, tab, semicolon, pipe)
  - detects encoding from the first 64 KB tap (utf-8, latin1)
  - caps sampleRows at maxSampleRows and still counts total rows correctly
  - accumulates column stats incrementally (no full-materialization)
  - propagates csv-parse errors as ProcessorError("CSV_PARSE_FAILED", ...)

describe("csvRowIterator")
  - yields Record<string,string> keyed by header row
  - respects explicit delimiter option (skips detection)
  - async-iterable shape: consumable with for await
  - propagates errors through the iterator
```

Feed the parser `Readable.from(Buffer.from(csvText, "utf8"))` in tests — never pass a pre-materialized buffer to the unit-under-test.

### 2b. Implement: `apps/api/src/utils/csv-parser.util.ts`

- Detection: pipe the source through a `PassThrough` that captures up to 64 KB, run encoding + delimiter detection on that tap, then feed the combined (tap + rest) stream into `csv-parse` in async mode
- `parseCsvStream`: `for await (const row of parser)` → update accumulators, keep up to `maxSampleRows` in a ring, count rows, return `FileParseResult`
- `csvRowIterator`: `for await (const row of parser)` → yield `Record<string, string>` keyed by headers
- Reuse `csv-parse` (already at v6.2.0)
- Reuse `createAccumulator` / `updateAccumulator` / `finalizeAccumulator` from step 1

### 2c. Verify

```bash
cd apps/api && npx jest --testPathPattern="csv-parser" --no-coverage
```

---

## Step 3 — Implement streaming `record-import.util.ts` (TDD)

**Goal:** Extract the shared normalization/checksum/batch-upsert pipeline from `csv-import.service.ts` as an async-iterable consumer. Peak memory O(BATCH_SIZE).

### 3a. Write tests: `apps/api/src/__tests__/services/record-import.util.test.ts`

```
describe("importRows")
  - consumes an async iterable and upserts to DB
  - computes SHA-256 checksum per row
  - uses row index as sourceId
  - flushes batches at 500 rows (assert upsert called with batches of <=500)
  - flushes final partial batch after iterable ends
  - returns { created, updated, unchanged, invalid } counts
  - skips unchanged rows (matching checksum)
  - marks updated rows (different checksum, same sourceId)
  - handles empty iterable (returns all zeros, no DB calls)
  - persists validationErrors and isValid from normalization
  - fetches field mappings exactly once
  - propagates DB-level errors (does not swallow)
  - does not materialize the full row set in memory (verify via iterator spy)
```

Use async generators as fixtures:

```ts
async function* makeRows(n: number) { for (let i = 0; i < n; i++) yield { ... }; }
```

Mock setup mirrors `csv-import.service.test.ts` — mock `DbService.repository.entityRecords`, `DbService.repository.fieldMappings`, and the schema import.

### 3b. Implement: `apps/api/src/services/record-import.util.ts`

Signature: `importRows(rows: AsyncIterable<Record<string, string>>, params: ImportRowsParams): Promise<ImportResult>`.

- Fetch field mappings once
- `for await (const row of rows)`: normalize via `NormalizationService.normalizeWithMappings`, checksum, push onto in-flight batch
- When batch hits `BATCH_SIZE = 500`: `upsertManyBySourceId(batch)`, reset, update counts
- After the loop, flush remaining partial batch
- Return counts

### 3c. Verify

```bash
cd apps/api && npx jest --testPathPattern="record-import" --no-coverage
```

---

## Step 4 — Convert `file-upload.processor.ts` to stream CSV (TDD)

**Goal:** Remove the `Buffer.concat` block (current lines ~189-206) and feed the S3 `Readable` directly into `parseCsvStream`. No XLSX branch yet — pure streaming conversion of the existing CSV path.

### 4a. Update tests: `apps/api/src/__tests__/queues/processors/file-upload.processor.test.ts`

- Existing CSV parse tests continue to pass — the processor contract (input: `FileUploadFile`, output: `FileParseResult[]`) is unchanged at the boundaries
- Add a streaming smoke test: mock S3 to return a `Readable` that emits 50,000 rows in small chunks. Verify the processor completes and that the S3 stream is consumed incrementally (spy on chunk count to ensure it's not all read up-front)
- Remove any test helpers that relied on `streamToBuffer` / buffer shapes

### 4b. Update `file-upload.processor.ts`

- Change `parseFile()` return type from `FileParseResult` to `FileParseResult[]` (single element for CSV in this step; multi-element for XLSX in Phase 2)
- Replace body:

```ts
async function parseFile(file: FileUploadFile): Promise<FileParseResult[]> {
  const { stream } = await S3Service.getObjectStream(file.s3Key);
  return [await parseCsvStream(stream, { fileName: file.originalName })];
}
```

- Flatten at the call site:

```ts
const parseResultsNested = await Promise.all(files.map(parseFile));
const parseResults = parseResultsNested.flat();
```

- Delete `allChunks[]`, `Buffer.concat`, and any `streamToBuffer` helper

### 4c. Verify

```bash
cd apps/api && npx jest --testPathPattern="file-upload.processor" --no-coverage
```

---

## Step 5 — Convert `csv-import.service.ts` to stream (TDD)

**Goal:** Remove the buffer-collection loop at current lines ~110-116 and stream S3 → `csvRowIterator` → `importRows`.

### 5a. Update tests: `apps/api/src/__tests__/services/csv-import.service.test.ts`

- Existing tests continue to pass — input/output contract unchanged
- Add a streaming assertion: mock S3 with a large `Readable`, verify `importRows` is called with an async iterable (not an array)
- Remove any mocks that depended on the `chunks: Buffer[]` / `Buffer.concat` shape

### 5b. Update `csv-import.service.ts`

Replace the current body starting around line 110 with:

```ts
const { stream } = await S3Service.getObjectStream(s3Key);
const rows = csvRowIterator(stream, { delimiter });
return importRows(rows, params);
```

Delete the `chunks` accumulator, `Buffer.concat`, and `parseCSVBuffer` reference. The 500-row batching lives in `importRows` now.

### 5c. Verify

```bash
cd apps/api && npx jest --testPathPattern="csv-import" --no-coverage
```

**Checkpoint:** At this point Phase 1 is complete — the CSV pipeline is fully streaming, no XLSX code yet. All existing behavior preserved. Ship Phase 1 independently and validate under load before proceeding to Phase 2.

---

# Phase 2 — XLSX Support

## Step 6 — Install `exceljs` dependency

```bash
cd apps/api && npm install exceljs
```

No tests needed — dependency addition. Do **not** install `xlsx` (SheetJS CE has no free streaming reader; see `discovery.md` §4).

---

## Step 7 — Implement streaming `xlsx-parser.util.ts` (TDD)

**Goal:** Stream XLSX from a `Readable`, yielding one `FileParseResult` per non-empty sheet. Also export a per-sheet row iterator for import use.

### 7a. Add test fixture helper: `apps/api/src/__tests__/utils/xlsx-fixtures.util.ts`

Build XLSX buffers in-memory using exceljs writer — no binary fixtures committed:

```ts
export async function buildSingleSheetXlsx(sheetName: string, rows: string[][]): Promise<Buffer>;
export async function buildMultiSheetXlsx(sheets: Record<string, string[][]>): Promise<Buffer>;
export function toStream(buffer: Buffer): Readable;  // Readable.from(buffer)
```

### 7b. Write tests: `apps/api/src/__tests__/utils/xlsx-parser.util.test.ts`

```
describe("parseXlsxStream")
  Single-sheet:
    - yields one FileParseResult
    - sets fileName to "originalName[SheetName]"
    - sets delimiter to "xlsx"
    - sets hasHeader to true
    - sets encoding to "utf-8"
    - extracts headers from first row
    - extracts sampleRows (capped at maxSampleRows)
    - computes columnStats with correct counts and sample values
    - rowCount equals data rows (excludes header)

  Multi-sheet:
    - yields one FileParseResult per non-empty sheet
    - preserves sheet order from workbook
    - skips empty sheets (0 data rows)

  Data types:
    - converts Date cells to ISO 8601 strings
    - converts numbers to string representation
    - handles boolean cells ("true"/"false")
    - treats null/undefined cells as empty strings

  Edge cases:
    - skips sheets with only a header row and no data
    - handles sheet names with special characters (spaces, brackets, unicode)
    - handles merged cells (exceljs top-left-only behavior)
    - truncates columns beyond 500 to first 500

  Error handling:
    - throws ProcessorError("XLSX_PARSE_FAILED") for corrupted buffer
    - throws ProcessorError("XLSX_PASSWORD_PROTECTED") for encrypted workbook

describe("xlsxSheetRowIterator")
  - yields Record<string,string> keyed by header row
  - throws ApiError(400, "UPLOAD_SHEET_NOT_FOUND") when sheetName missing
  - async-iterable shape: consumable with for await
  - handles sheet with no data rows (yields nothing)
```

### 7c. Implement: `apps/api/src/utils/xlsx-parser.util.ts`

- `new ExcelJS.stream.xlsx.WorkbookReader(stream, { entries: "emit", sharedStrings: "cache", worksheets: "emit" })`
- `for await (const worksheetReader of workbookReader)`:
  - Track sheet name, skip if empty after processing
  - First row → headers (cap at 500 cols; warn if truncating)
  - Subsequent rows → feed `createAccumulator`/`updateAccumulator` from `column-stats.util.ts`, maintain ring of sample rows
  - After sheet closes, yield `FileParseResult` if `rowCount > 0`
- Cell value coercion: use `row.getCell(n).text`; `Date` → ISO; `null`/`undefined` → `""`; `boolean` → `"true"`/`"false"`
- Wrap exceljs errors into `ProcessorError` variants

### 7d. Verify

```bash
cd apps/api && npx jest --testPathPattern="xlsx-parser" --no-coverage
```

---

## Step 8 — Implement `xlsx-import.service.ts` (TDD)

**Goal:** Stream a specific sheet from an XLSX file in S3 and import rows via the shared pipeline.

### 8a. Write tests: `apps/api/src/__tests__/services/xlsx-import.service.test.ts`

Mock S3 to return XLSX buffers wrapped in `Readable.from(...)` (built via the fixture helper). Mock DB same as csv-import tests.

```
describe("XlsxImportService.importFromS3")
  - streams XLSX from S3 and imports rows from the specified sheet
  - maps header row to field names in raw data
  - delegates to importRows() for normalization and upsert
  - returns { created, updated, unchanged, invalid }
  - throws ApiError(400, "UPLOAD_SHEET_NOT_FOUND") for nonexistent sheet name
  - handles sheet with no data rows (returns all zeros)
  - does not buffer the full file (verify via S3 stream chunk-count spy)
```

### 8b. Implement: `apps/api/src/services/xlsx-import.service.ts`

```ts
static async importFromS3(params) {
  const { stream } = await S3Service.getObjectStream(params.s3Key);
  const rows = xlsxSheetRowIterator(stream, params.sheetName);
  return importRows(rows, params);
}
```

### 8c. Verify

```bash
cd apps/api && npx jest --testPathPattern="xlsx-import" --no-coverage
```

---

## Step 9 — Add XLSX routing to `file-upload.processor.ts` (TDD)

**Goal:** Detect `.xlsx` files and route to the XLSX parser; keep the streaming CSV path from step 4.

### 9a. Add tests: `apps/api/src/__tests__/queues/processors/file-upload.processor.test.ts`

```
describe("XLSX support")
  - parses a single-sheet .xlsx file and produces one parseResult
  - parses a multi-sheet .xlsx file and produces one parseResult per sheet
  - sets fileName to "file.xlsx[SheetName]" for each sheet
  - calls getRecommendations once per sheet
  - derives connector instance name from XLSX filename (not sheet name)
  - handles mixed upload: one .csv + one .xlsx with 2 sheets → 3 parseResults
  - rejects password-protected XLSX with ProcessorError("XLSX_PASSWORD_PROTECTED")
  - rejects corrupted XLSX with ProcessorError("XLSX_PARSE_FAILED")
  - rejects XLSX with no data sheets via ProcessorError("XLSX_NO_DATA")
```

Use the mock S3 helpers with `Readable.from(buffer)` where `buffer` comes from the exceljs fixture helper.

### 9b. Update `parseFile` in `file-upload.processor.ts`

```ts
async function parseFile(file: FileUploadFile): Promise<FileParseResult[]> {
  const { stream } = await S3Service.getObjectStream(file.s3Key);
  const extension = path.extname(file.originalName).toLowerCase();

  if (extension === ".xlsx") {
    const results: FileParseResult[] = [];
    for await (const result of parseXlsxStream(stream, { fileName: file.originalName })) {
      results.push(result);
    }
    if (results.length === 0) throw new ProcessorError("XLSX_NO_DATA", "No sheets with data found");
    return results;
  }

  return [await parseCsvStream(stream, { fileName: file.originalName })];
}
```

Update connector instance name derivation to strip the `[SheetName]` suffix before applying the existing transform.

### 9c. Verify

```bash
cd apps/api && npx jest --testPathPattern="file-upload.processor" --no-coverage
```

---

## Step 9b — Sheet-aware heuristic + AI prompt convention (TDD)

**Goal:** When XLSX rows reach the heuristic fallback path, derive a per-sheet `entityKey` instead of collapsing all sheets in a workbook to the same key. Also document the `[SheetName]` filename convention in the AI prompt so the LLM produces stable sheet-aware keys.

### 9b.1 Update tests: `apps/api/src/__tests__/utils/heuristic-analyzer.util.test.ts`

```
describe("heuristicAnalyze — XLSX sheet naming")
  - derives entityKey from sheet name when fileName matches "<file>.xlsx[<Sheet>]"
  - derives entityLabel from sheet name when fileName matches "<file>.xlsx[<Sheet>]"
  - sets sourceFileName to the full "<file>.xlsx[<Sheet>]" string (unchanged)
  - falls back to filename-derivation for plain CSV (no brackets)
  - handles sheet names with spaces ("Deal History" → "deal_history")
```

### 9b.2 Implement: `apps/api/src/utils/heuristic-analyzer.util.ts`

Add a small helper at module scope:

```ts
function parseFileName(fileName: string): { base: string; sheet: string | null } {
  const match = fileName.match(/^(.+?)\[([^\]]+)\]$/);
  if (match) return { base: match[1], sheet: match[2] };
  return { base: fileName, sheet: null };
}
```

Rewrite the entityKey/entityLabel derivation around lines 247-248:

```ts
const { base, sheet } = parseFileName(parseResult.fileName);
const stem = (sheet ?? base).replace(/\.[^.]+$/, "");
const entityKey = toSnakeCase(stem);
const entityLabel = stem;
```

`sourceFileName` stays as `parseResult.fileName` so the confirm-time `extractSheetName()` parser (Step 10) still finds the bracketed sheet.

### 9b.3 Update AI prompt: `apps/api/src/prompts/file-analysis.prompt.ts`

Add one sentence near the top of the file-context section:

> XLSX files use the convention `<workbook>.xlsx[<SheetName>]` in `fileName`. When you see this format, derive `entityKey` and `entityLabel` from the sheet name, not the workbook name — each sheet is a distinct entity.

If a prompt snapshot test exists, regenerate it.

### 9b.4 Verify

```bash
cd apps/api && npx jest --testPathPattern="heuristic-analyzer|file-analysis" --no-coverage
```

---

## Step 10 — Update `uploads.service.ts` for XLSX import routing (TDD)

**Goal:** During confirmation, route to CSV or XLSX import service based on file extension.

### 10a. Write tests: `apps/api/src/__tests__/services/uploads.service.test.ts`

```
describe("confirm() — XLSX routing")
  - calls XlsxImportService for .xlsx entities with correct sheetName
  - calls CsvImportService for .csv entities (unchanged behavior)
  - handles mixed confirm with both .csv and .xlsx entities
  - extracts sheet name from sourceFileName "file.xlsx[SheetName]" convention

describe("extractSheetName()")
  - returns sheet name from "file.xlsx[Contacts]"
  - returns null for "file.csv" (no brackets)
  - handles sheet names with spaces: "file.xlsx[Deal History]"
```

### 10b. Implement changes in `uploads.service.ts`

- Import `XlsxImportService`
- Add `extractSheetName()` helper
- In the import loop: check extension, route to XLSX or CSV service

### 10c. Verify

```bash
cd apps/api && npx jest --testPathPattern="uploads.service" --no-coverage
```

---

## Step 11 — Config + infra updates

### 11a. Write test: `apps/api/src/__tests__/routes/uploads.router.test.ts`

```
- accepts .xlsx files in presign request
- still accepts .csv files (regression check)
```

### 11b. Implement

- `apps/api/src/routes/uploads.router.ts`: default `UPLOAD_ALLOWED_EXTENSIONS` → `.csv,.xlsx`
- `apps/api/Dockerfile`: change `CMD ["node", "dist/index.js"]` → `CMD ["node", "--max-old-space-size=3200", "dist/index.js"]`
- `apps/api/src/queues/jobs.worker.ts`: cap file-upload worker concurrency at `2`
- `apps/api/.env.example`: document raised `UPLOAD_MAX_FILE_SIZE_MB` and `UPLOAD_MAX_FILES` suggestions for production

### 11c. Verify

```bash
cd apps/api && npx jest --testPathPattern="uploads" --no-coverage
```

### 11d. Large-file smoke test (manual)

Generate fixtures via one-off scripts (not committed):

- 200 MB CSV — upload via local web, confirm parse completes, watch `process.memoryUsage().heapUsed` stays bounded
- 100 MB XLSX with 3 sheets (using exceljs streaming writer) — same check

**Checkpoint:** Phase 2 complete. XLSX works end-to-end on the backend with streaming, gated by `UPLOAD_ALLOWED_EXTENSIONS`. Ship independently if desired — the frontend still says "CSV" but the backend accepts XLSX.

---

# Phase 3 — Frontend Generalization

## Step 12 — Update `UploadStep` for XLSX (TDD)

### 12a. Update tests: `apps/web/src/workflows/CSVConnector/__tests__/UploadStep.test.tsx`

Update existing assertions and add new ones:

```
Update existing:
  - "renders FileUploader with .csv accept attribute"
    → change assertion to check for ".csv, .xlsx" in accepted formats text
  - "renders file picker prompt when phase is idle"
    → update expected text from "CSV files" to "files"
  - 'shows "Parsing CSV files..." when done with jobProgress 11-29'
    → update expected text to "Parsing files..."

New tests:
  describe("XLSX parse results")
    - displays "N/A" for delimiter when delimiter is "xlsx"
    - displays sheet name from fileName "data.xlsx[Contacts]"
    - displays parse summary for multi-sheet XLSX results
```

### 12b. Implement changes in `UploadStep.component.tsx`

- Change `accept=".csv"` → `accept=".csv,.xlsx"`
- Update helper text: "Accepted formats: .csv, .xlsx ..."
- Update phase label: "Parsing files..." (drop "CSV")
- Update `formatDelimiter()`: return "N/A" for `"xlsx"`
- Parse and display sheet name from `fileName` when it contains `[...]`
- Update idle prompt text to be format-neutral

### 12c. Verify

```bash
cd apps/web && npx jest --testPathPattern="UploadStep" --no-coverage
```

---

## Step 13 — Update `EntityStep` for sheet names (TDD)

### 13a. Update tests: `apps/web/src/workflows/CSVConnector/__tests__/EntityStep.test.tsx`

```
New tests:
  describe("XLSX sheet display")
    - shows sheet name when sourceFileName is "data.xlsx[Contacts]"
    - shows "N/A" for delimiter when parse result delimiter is "xlsx"
    - shows plain filename when sourceFileName is "data.csv" (no brackets)
```

Use mock entities/parse results with XLSX-style `sourceFileName` and `delimiter: "xlsx"`.

### 13b. Implement changes in `EntityStep.component.tsx`

- Parse `sourceFileName` to extract sheet context
- Display "Source: data.xlsx — Sheet: Contacts" when sheet name is present
- Handle `delimiter: "xlsx"` in parse summary display

### 13c. Verify

```bash
cd apps/web && npx jest --testPathPattern="EntityStep" --no-coverage
```

---

## Step 14 — Update workflow container labels (TDD)

### 14a. Update tests: `apps/web/src/workflows/CSVConnector/__tests__/CSVConnectorWorkflow.test.tsx`

```
Update existing:
  - Modal title assertion: "CSV File Upload" → "File Upload"
  - Any step label assertions referencing "CSV"
```

### 14b. Implement changes

- `upload-workflow.util.ts`: update `WORKFLOW_STEPS` labels — "Upload Files", "Select and upload files"
- `CSVConnectorWorkflow.component.tsx`: modal title "File Upload"

### 14c. Verify

```bash
cd apps/web && npx jest --testPathPattern="CSVConnectorWorkflow" --no-coverage
```

---

## Step 15 — Rename workflow directory

**Goal:** Rename `CSVConnector` → `FileUploadConnector` for accuracy.

### 15a. Rename files

```
workflows/CSVConnector/ → workflows/FileUploadConnector/
CSVConnectorWorkflow.component.tsx → FileUploadConnectorWorkflow.component.tsx
CSVConnectorWorkflow.test.tsx → FileUploadConnectorWorkflow.test.tsx
CSVConnectorWorkflow.stories.tsx → FileUploadConnectorWorkflow.stories.tsx
csv-validation.util.ts → file-upload-validation.util.ts
csv-validation.util.test.ts → file-upload-validation.util.test.ts
```

### 15b. Update all imports across the codebase

- Grep for `CSVConnector` and `csv-validation` imports, update to new paths
- Update barrel `index.ts` exports with backwards-compat re-export:

```ts
export { FileUploadConnectorWorkflow as CSVConnectorWorkflow } from "./FileUploadConnectorWorkflow.component";
```

### 15c. Verify

Full test suite:

```bash
npm run test
npm run type-check
```

---

## Final Verification

After all steps:

```bash
# Full backend test suite
cd apps/api && npx jest --no-coverage

# Full frontend test suite
cd apps/web && npx jest --no-coverage

# Type checking across monorepo
npm run type-check

# Lint
npm run lint
```

**Large-file smoke** (repeat after Phase 3):

- Upload a 200 MB CSV via the UI; confirm parse → recommend → confirm → records in DB with bounded heap
- Upload a 100 MB multi-sheet XLSX; same check
- Hit the raised `UPLOAD_MAX_FILE_SIZE_MB` and `UPLOAD_MAX_FILES` limits in staging before flipping them in production

---

## Critical Files Reference

### New files

| File | Purpose |
|------|---------|
| `apps/api/src/utils/column-stats.util.ts` | Shared column statistics accumulator |
| `apps/api/src/__tests__/utils/column-stats.util.test.ts` | Tests for above |
| `apps/api/src/utils/csv-parser.util.ts` | Streaming CSV parser + row iterator |
| `apps/api/src/__tests__/utils/csv-parser.util.test.ts` | Tests for above |
| `apps/api/src/utils/xlsx-parser.util.ts` | Streaming XLSX parser + per-sheet row iterator |
| `apps/api/src/__tests__/utils/xlsx-parser.util.test.ts` | Tests for above |
| `apps/api/src/services/xlsx-import.service.ts` | Stream XLSX sheet from S3 → `importRows` |
| `apps/api/src/__tests__/services/xlsx-import.service.test.ts` | Tests for above |
| `apps/api/src/services/record-import.util.ts` | Shared async-iterable row importer |
| `apps/api/src/__tests__/services/record-import.util.test.ts` | Tests for above |
| `apps/api/src/__tests__/utils/xlsx-fixtures.util.ts` | In-memory XLSX fixture builder (exceljs writer) |

### Modified files

| File | Change |
|------|--------|
| `apps/api/src/queues/processors/file-upload.processor.ts` | Remove `Buffer.concat`, stream S3 → `parseCsvStream` / `parseXlsxStream`, flatten results |
| `apps/api/src/services/csv-import.service.ts` | Remove buffer loop, stream S3 → `csvRowIterator` → `importRows` |
| `apps/api/src/services/uploads.service.ts` | Route to XLSX import service by extension; `extractSheetName()` helper |
| `apps/api/src/utils/heuristic-analyzer.util.ts` | Strip `[SheetName]` suffix when deriving `entityKey` / `entityLabel` so XLSX sheets get distinct heuristic-fallback keys |
| `apps/api/src/prompts/file-analysis.prompt.ts` | Document the `<file>.xlsx[<Sheet>]` convention so the LLM derives keys per-sheet |
| `apps/api/src/routes/uploads.router.ts` | Default allowed extensions `.csv,.xlsx` |
| `apps/api/src/queues/jobs.worker.ts` | Cap file-upload job concurrency at 2 |
| `apps/api/Dockerfile` | Add `--max-old-space-size=3200` to node CMD |
| `apps/api/.env.example` | Suggested production values for `UPLOAD_MAX_FILE_SIZE_MB` / `UPLOAD_MAX_FILES` |
| `apps/api/package.json` | Add `exceljs` dep |
| `apps/web/src/workflows/.../UploadStep.component.tsx` | Accept `.xlsx`, update labels, delimiter display |
| `apps/web/src/workflows/.../EntityStep.component.tsx` | Sheet name display |
| `apps/web/src/workflows/.../CSVConnectorWorkflow.component.tsx` | Modal title, step labels |
| `apps/web/src/workflows/.../utils/upload-workflow.util.ts` | Step label text |

### Existing test files to update

| File | New cases |
|------|-----------|
| `apps/api/src/__tests__/queues/processors/file-upload.processor.test.ts` | Streaming CSV smoke, XLSX parsing, multi-sheet, mixed upload |
| `apps/api/src/__tests__/services/csv-import.service.test.ts` | Streaming assertion (async iterable to `importRows`) |
| `apps/api/src/__tests__/services/uploads.service.test.ts` | XLSX confirm routing, sheet name extraction |
| `apps/web/src/workflows/.../UploadStep.test.tsx` | XLSX accept, delimiter N/A, sheet display |
| `apps/web/src/workflows/.../EntityStep.test.tsx` | XLSX sheet name rendering |
| `apps/web/src/workflows/.../CSVConnectorWorkflow.test.tsx` | Updated title/label assertions |

### Reusable existing code (do not rewrite)

| Utility | Path | Reuse |
|---------|------|-------|
| `S3Service.getObjectStream` | `apps/api/src/services/s3.service.ts:40-56` | Returns a `Readable` — consume directly |
| `useFileUpload` | `apps/web/src/utils/file-upload.util.ts` | S3 presign/upload — format-agnostic |
| `useUploadWorkflow` | `workflows/.../utils/upload-workflow.util.ts` | Step orchestration, SSE, confirm — format-agnostic |
| `NormalizationService` | `apps/api/src/services/normalization.service.ts` | Row normalization through field mappings |
| `FileAnalysisService` | `apps/api/src/services/file-analysis.service.ts` | AI recommendations — works on parsed data |
| `heuristicAnalyze` | `apps/api/src/utils/heuristic-analyzer.util.ts` | Fallback type inference |
| `FileParseResultSchema` | `packages/core/src/models/job.model.ts` | Already accommodates XLSX values |
| `ConfirmRequestBodySchema` | `packages/core/src/contracts/upload.contract.ts` | Format-agnostic |
