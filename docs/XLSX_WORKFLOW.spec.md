# XLSX Upload Workflow — Feature Specification

> Companion to `XLSX_WORKFLOW.discovery.md`. This document specifies the exact changes required to enable XLSX file upload workflows by extending the existing CSV upload infrastructure.

---

## 1. Design Summary

Add XLSX support to the existing file upload pipeline by introducing a format-aware parsing layer. The upload, recommendation, confirmation, and import flows remain identical — only the file parsing and row-reading code is format-specific. Multi-sheet XLSX files naturally map to the existing multi-entity model (one sheet = one entity, same as one CSV file = one entity).

As part of this work, the CSV path is also converted from its current buffered (`Buffer.concat`) model to streaming, so that both formats share the same memory-bounded pipeline. See `XLSX_WORKFLOW.discovery.md` for the scaling analysis that motivated this.

### Principles

- **Extend, don't duplicate.** The CSV workflow's UI, hooks, validation, contracts, and API routes are format-agnostic. Reuse them directly.
- **Stream, don't buffer.** Parse and import both consume S3 `Readable` streams directly and accumulate batch-size state only. Peak memory is constant per job, independent of file size.
- **Format detection at the processor.** The BullMQ job processor inspects the file extension and delegates to the appropriate streaming parser. Everything downstream receives the same `FileParseResult` shape.
- **No new API endpoints.** The existing presign/process/confirm routes handle XLSX without changes (beyond allowed extensions config).
- **No new frontend workflow.** The existing `CSVConnectorWorkflow` is generalized into a `FileUploadWorkflow` that accepts both `.csv` and `.xlsx` files.

---

## 2. Scope

### In Scope

| Area | Change |
|------|--------|
| XLSX parsing | New `xlsx-parser.util.ts` in API that parses `.xlsx` files into `FileParseResult[]` |
| XLSX import | New `xlsx-import.service.ts` in API that reads XLSX rows for record creation |
| Format routing | `file-upload.processor.ts` detects extension and delegates to CSV or XLSX parser |
| Confirmation routing | `uploads.service.ts` delegates to CSV or XLSX import service based on file extension |
| Allowed extensions | Config change to include `.xlsx` alongside `.csv` |
| Frontend generalization | Rename workflow, update `accept` prop, update labels to be format-neutral |
| Library addition | Add `exceljs` to `apps/api` dependencies (streaming XLSX reader) |
| CSV refactor | Convert existing CSV parsing and import from buffered (`Buffer.concat`) to streaming, matching the XLSX pipeline |
| Infra | Dockerfile `--max-old-space-size=3200`, cap BullMQ file-upload concurrency at 2 |

### Out of Scope

- `.xls` (legacy binary format) — can be added later with the same pattern
- Client-side XLSX preview/parsing — files are parsed server-side only
- Sheet selection UI — all sheets are imported (user edits entities in Step 1)
- Formula evaluation — cells are read as resolved values
- Pivot tables, charts, macros — ignored during parsing
- Password-protected XLSX files — rejected with a clear error

---

## 3. Library Choice

**`exceljs`** — MIT-licensed, ships a streaming `WorkbookReader` in the free package. SheetJS Community (`xlsx`) was rejected because its streaming reader is a paid Pro feature; the CE package only supports whole-workbook reads, which will OOM as upload limits grow. See `XLSX_WORKFLOW.discovery.md` §4 for the full comparison.

| Criterion | `exceljs` |
|-----------|-----------|
| Format support | `.xlsx`, `.csv` |
| Runtime | Pure JavaScript, no native dependencies |
| Memory | Constant per sheet — streams rows via async iteration over a `Readable` |
| API | `new ExcelJS.stream.xlsx.WorkbookReader(stream, opts)`; `for await (const ws of workbook) { for await (const row of ws) { … } }` |
| License | MIT |
| Bundle size | Server-only; no frontend impact |
| Types | Ships its own |

CSV parsing stays on the existing `csv-parse` dependency (v6.2.0), which already supports streaming mode. The refactor stops pre-materializing the input buffer.

Install in `apps/api/`:

```bash
npm install exceljs
```

No new CSV dependency needed. Do **not** install `xlsx`.

---

## 4. Backend Changes

### 4.1 New File: `apps/api/src/utils/xlsx-parser.util.ts`

Streams an XLSX file from a `Readable`, yielding one `FileParseResult` per non-empty sheet. Also exports a row iterator for import-time use.

```ts
import type { Readable } from "node:stream";

import { FileParseResult } from "@portalai/core/models";

interface SheetParseOptions {
  fileName: string;         // original XLSX filename, used to build `${fileName}[${sheetName}]`
  maxSampleRows?: number;   // default: 20
  maxSampleValues?: number; // default: 10
  maxUniqueValues?: number; // default: 1000
}

/**
 * Stream an XLSX file, yielding one FileParseResult per non-empty sheet.
 * Empty sheets (0 data rows) are skipped. Peak memory is O(maxSampleRows + columns), not O(file size).
 */
export async function* parseXlsxStream(
  stream: Readable,
  options: SheetParseOptions,
): AsyncIterable<FileParseResult>;

/**
 * Stream rows from a single named sheet as Record<string,string> keyed by header row.
 * Used by xlsx-import.service.ts. Throws UPLOAD_SHEET_NOT_FOUND if the sheet is missing.
 */
export async function* xlsxSheetRowIterator(
  stream: Readable,
  sheetName: string,
): AsyncIterable<Record<string, string>>;
```

**Implementation details:**

1. `new ExcelJS.stream.xlsx.WorkbookReader(stream, { entries: "emit", sharedStrings: "cache", worksheets: "emit" })`
2. `for await (const worksheetReader of workbookReader)`:
   - Track sheet name (`worksheetReader.name`)
   - First row → headers (coerce to `string[]`, capped at 500 columns)
   - Subsequent rows → feed column-stats accumulators; keep up to `maxSampleRows` in a ring
   - When the worksheet closes, `yield` a `FileParseResult` if `rowCount > 0`; skip empty sheets
3. `FileParseResult` shape per yielded sheet:

```ts
{
  fileName: `${options.fileName}[${sheetName}]`,  // e.g. "data.xlsx[Contacts]"
  delimiter: "xlsx",       // sentinel value, not applicable
  hasHeader: true,         // XLSX always has typed headers
  encoding: "utf-8",       // XLSX is XML-based UTF-8
  rowCount,                // accumulated during streaming
  headers: headerRow,
  sampleRows,              // first N rows captured during streaming
  columnStats,             // finalized accumulators
}
```

**Cell value coercion:** use `row.getCell(n).text` (respects display formatting); `Date` → ISO 8601 string; null/undefined → `""`; booleans → `"true"`/`"false"`.

**Edge cases:**
- Merged cells: exceljs fills the merged value into the top-left cell, blanks the rest
- Date cells: returned as JS `Date` — coerce to ISO 8601 strings
- Empty columns: included with high null-rate stats (signals optional field)
- Sheet names with special characters: preserved as-is in `fileName`
- >500 columns: truncate to first 500, emit a one-time warning in the result

### 4.2 New File: `apps/api/src/utils/column-stats.util.ts`

Extract the shared column statistics accumulator from `file-upload.processor.ts` into a reusable utility. Both CSV and XLSX parsers will import from here.

```ts
import { ColumnStat } from "@portalai/core/models";

export interface ColumnAccumulator {
  name: string;
  nullCount: number;
  totalCount: number;
  uniqueValues: Set<string>;
  minLength: number;
  maxLength: number;
  sampleValues: string[];
}

export function createAccumulator(name: string): ColumnAccumulator;
export function updateAccumulator(acc: ColumnAccumulator, value: string): void;
export function finalizeAccumulator(acc: ColumnAccumulator): ColumnStat;
```

**Migration:** `file-upload.processor.ts` imports these instead of defining them inline. No behavior change.

### 4.3 New File: `apps/api/src/services/xlsx-import.service.ts`

Streams rows from a single XLSX sheet in S3 and hands them to the shared importer. Parallel to `csv-import.service.ts`.

```ts
import { ImportResult } from "./record-import.util";

interface XlsxImportParams {
  s3Key: string;
  sheetName: string;            // which sheet to import from
  connectorEntityId: string;
  organizationId: string;
  userId: string;
}

export class XlsxImportService {
  /**
   * Stream the specified sheet from S3, normalize rows through field mappings,
   * and batch-upsert into entity_records. Peak memory is O(BATCH_SIZE).
   */
  static async importFromS3(params: XlsxImportParams): Promise<ImportResult>;
}
```

**Implementation details:**

1. `const { stream } = await S3Service.getObjectStream(params.s3Key)` — `Readable` directly; no buffering
2. `const rows = xlsxSheetRowIterator(stream, params.sheetName)` — async iterable of `Record<string,string>` keyed by headers
3. `return importRows(rows, params)` — the shared importer handles mappings, normalization, checksums, batching

Throw `ApiError(400, "UPLOAD_SHEET_NOT_FOUND")` if the sheet is missing (detected inside `xlsxSheetRowIterator`).

**Shared logic:** mapping lookup, normalization, checksum, and batch upsert all live in `record-import.util.ts` and are consumed identically by the CSV and XLSX paths.

### 4.4 Modified File: `apps/api/src/queues/processors/file-upload.processor.ts`

Convert `parseFile` from buffered to streaming and add format routing. The inline `allChunks` / `Buffer.concat` block at lines ~189-206 is removed — the S3 `Readable` is fed directly into the format-specific parser.

**New imports:**
```ts
import { parseXlsxStream } from "../utils/xlsx-parser.util";
import { parseCsvStream } from "../utils/csv-parser.util";
import { createAccumulator, updateAccumulator, finalizeAccumulator } from "../utils/column-stats.util";
```

**New `parseFile()`:**

```ts
async function parseFile(file: FileUploadFile): Promise<FileParseResult[]> {
  const { stream } = await S3Service.getObjectStream(file.s3Key);
  const extension = path.extname(file.originalName).toLowerCase();

  if (extension === ".xlsx") {
    const results: FileParseResult[] = [];
    for await (const result of parseXlsxStream(stream, { fileName: file.originalName })) {
      results.push(result);
    }
    return results;
  }

  return [await parseCsvStream(stream, { fileName: file.originalName })];
}
```

**No `Buffer.concat`, no `allChunks[]`, no `streamToBuffer` helper.** The whole file never sits in memory.

**Return type:** `parseFile` returns `FileParseResult[]` (was `FileParseResult`) to support multi-sheet XLSX. The calling code flattens:

```ts
// Before:
const parseResults = await Promise.all(files.map(parseFile));

// After:
const parseResultsNested = await Promise.all(files.map(parseFile));
const parseResults = parseResultsNested.flat();
```

**Phase 3 (AI analysis):** Called once per `FileParseResult` — unchanged; already iterates per result.

**Phase 4 (Recommendation assembly):** The connector instance name derivation strips the `[SheetName]` suffix and file extension, using the base XLSX filename.

### 4.5 Modified File: `apps/api/src/services/csv-import.service.ts`

Delete the buffer-collection loop (current lines ~110-116):

```ts
// REMOVE:
const { stream } = await S3Service.getObjectStream(s3Key);
const chunks: Buffer[] = [];
for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
const buffer = Buffer.concat(chunks);
// ...then parseCSVBuffer(buffer, delimiter)...
// ...then iterate materialized dataRows array...
```

Replace with streaming:

```ts
const { stream } = await S3Service.getObjectStream(s3Key);
const rows = csvRowIterator(stream, { delimiter });  // from csv-parser.util.ts
return importRows(rows, params);
```

`csvRowIterator` is exported from `csv-parser.util.ts` alongside `parseCsvStream` and shares the `csv-parse` configuration.

### 4.6 Modified File: `apps/api/src/services/uploads.service.ts`

Route to the correct import service based on file extension.

**New import:**
```ts
import { XlsxImportService } from "./xlsx-import.service";
```

**Changes to `confirm()` — import loop:**

```ts
// Current:
const importResult = await CsvImportService.importFromS3({ s3Key, ... });

// Updated:
const extension = path.extname(file.originalName).toLowerCase();
const importResult = extension === ".xlsx"
  ? await XlsxImportService.importFromS3({ s3Key, sheetName, ... })
  : await CsvImportService.importFromS3({ s3Key, ... });
```

**Sheet name resolution:** The `sheetName` for each entity is derived from the `sourceFileName` field in the confirm request body. For XLSX entities, `sourceFileName` follows the `"filename.xlsx[SheetName]"` convention established by the parser. Extract via:

```ts
function extractSheetName(sourceFileName: string): string | null {
  const match = sourceFileName.match(/\[(.+)\]$/);
  return match ? match[1] : null;
}
```

### 4.7 Modified File: Environment / Config / Infra

**Allowed extensions** in `uploads.router.ts`:

```ts
// Before:
const ALLOWED_EXTENSIONS = (process.env.UPLOAD_ALLOWED_EXTENSIONS ?? ".csv").split(",");

// After:
const ALLOWED_EXTENSIONS = (process.env.UPLOAD_ALLOWED_EXTENSIONS ?? ".csv,.xlsx").split(",");
```

**Node heap** in `apps/api/Dockerfile`:

```dockerfile
# Before:
CMD ["node", "dist/index.js"]

# After:
CMD ["node", "--max-old-space-size=3200", "dist/index.js"]
```

Headroom for concurrent XLSX zip decompression even with streaming. Assumes ≥4 GB container memory in production.

**BullMQ worker concurrency** in `jobs.worker.ts`: cap file-upload job concurrency at 2. Streaming caps per-job memory; concurrency is the remaining variable.

**Upload limits** in env (`UPLOAD_MAX_FILE_SIZE_MB`, `UPLOAD_MAX_FILES`): raise to the target production values in deployment config. Do not hardcode — the streaming pipeline places no fixed upper bound.

No DB migration needed — existing deployments pick up the new extension default.

---

## 5. Shared Utility Extraction

To avoid duplicating row-import logic between CSV and XLSX services, extract the shared normalization/upsert pipeline — and crucially, make it streaming-native.

### 5.1 New File: `apps/api/src/services/record-import.util.ts`

```ts
export interface ImportRowsParams {
  connectorEntityId: string;
  organizationId: string;
  userId: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  unchanged: number;
  invalid: number;
}

/**
 * Consume an async iterable of raw rows, normalize through field mappings,
 * and batch-upsert into entity_records. Shared by CSV and XLSX import services.
 * Peak memory is O(BATCH_SIZE), independent of total row count.
 *
 * @param rows - Async iterable of raw row objects keyed by source field names
 * @param params - Entity and org context
 * @returns Import counts
 */
export async function importRows(
  rows: AsyncIterable<Record<string, string>>,
  params: ImportRowsParams,
): Promise<ImportResult>;
```

**Extracted from `csv-import.service.ts`** steps 5-8, with streaming semantics:

1. Fetch field mappings **once** via `FieldMappingsRepository.findByConnectorEntityId()`
2. `for await (const row of rows)`: normalize via `NormalizationService.normalizeWithMappings(mappings, row)`
3. Compute SHA-256 checksum of normalized data
4. Push onto in-flight batch; when batch hits `BATCH_SIZE = 500`, flush via `EntityRecordsRepository.upsertManyBySourceId()`, reset, update counts
5. Flush any remaining partial batch after the iterable ends
6. Return created / updated / unchanged / invalid counts

After extraction, `CsvImportService.importFromS3()` becomes:

```ts
static async importFromS3(params) {
  const { stream } = await S3Service.getObjectStream(params.s3Key);
  const rows = csvRowIterator(stream, { delimiter: params.delimiter });  // format-specific iterator
  return importRows(rows, params);                                        // shared
}
```

And `XlsxImportService.importFromS3()` becomes:

```ts
static async importFromS3(params) {
  const { stream } = await S3Service.getObjectStream(params.s3Key);
  const rows = xlsxSheetRowIterator(stream, params.sheetName);  // format-specific iterator
  return importRows(rows, params);                               // shared
}
```

### 5.2 New File: `apps/api/src/utils/csv-parser.util.ts`

Extracted + refactored from the inline `parseCSVBuffer` function in the current processor. Two exports:

```ts
/**
 * Stream a CSV from a Readable, compute column stats + sample rows, return a FileParseResult.
 * Peak memory is O(maxSampleRows + columns).
 */
export async function parseCsvStream(
  stream: Readable,
  options: { fileName: string; maxSampleRows?: number },
): Promise<FileParseResult>;

/**
 * Stream rows from a CSV as Record<string,string> keyed by header row.
 * Used by csv-import.service.ts.
 */
export async function* csvRowIterator(
  stream: Readable,
  options: { delimiter: string },
): AsyncIterable<Record<string, string>>;
```

Implementation notes:

- Encoding + delimiter detection uses a `PassThrough` tap over the first 64 KB so the detection buffer is bounded, then forwards the (tap + rest) stream into `csv-parse`. No full-file buffering.
- `csv-parse` is used in async event mode (already a dep at v6.2.0). The iterator consumes `parser` via `for await`.
- The column-stats accumulators from `column-stats.util.ts` are fed row-by-row as the parser yields records.

See §4.2 for `column-stats.util.ts`, which both `csv-parser.util.ts` and `xlsx-parser.util.ts` consume.

---

## 6. Core Model Changes

### 6.1 `packages/core/src/models/job.model.ts`

No schema changes required. The existing `FileParseResultSchema` already accommodates XLSX:

| Field | CSV value | XLSX value | Compatible? |
|-------|-----------|------------|-------------|
| `fileName` | `"data.csv"` | `"data.xlsx[Contacts]"` | Yes (string) |
| `delimiter` | `","`, `"\t"`, etc. | `"xlsx"` | Yes (string) |
| `hasHeader` | `true`/`false` | `true` (always) | Yes (boolean) |
| `encoding` | `"utf-8"`, `"latin1"` | `"utf-8"` (always) | Yes (string) |
| `rowCount` | number | number | Yes |
| `headers` | string[] | string[] | Yes |
| `sampleRows` | string[][] | string[][] | Yes |
| `columnStats` | ColumnStat[] | ColumnStat[] | Yes |

### 6.2 `packages/core/src/contracts/upload.contract.ts`

No changes required. The `PresignFileSchema`, `ConfirmEntitySchema`, and `ConfirmColumnSchema` are all format-agnostic. The `sourceFileName` field in `ConfirmEntitySchema` carries the `"file.xlsx[Sheet]"` convention transparently.

---

## 7. Frontend Changes

### 7.1 Generalize the Workflow

Rename the workflow from CSV-specific to format-generic. This is a naming/labeling change — the component architecture, hooks, and validation logic are unchanged.

#### File Renames

| Current | New |
|---------|-----|
| `workflows/CSVConnector/` | `workflows/FileUploadConnector/` |
| `CSVConnectorWorkflow.component.tsx` | `FileUploadConnectorWorkflow.component.tsx` |
| `CSVConnectorWorkflow.test.tsx` | `FileUploadConnectorWorkflow.test.tsx` |
| `CSVConnectorWorkflow.stories.tsx` | `FileUploadConnectorWorkflow.stories.tsx` |

Validation utils (`csv-validation.util.ts`) rename to `file-upload-validation.util.ts` — contents unchanged, only entity/column validation (not format-specific).

#### Updated Exports (`index.ts`)

```ts
export { FileUploadConnectorWorkflow, FileUploadConnectorWorkflowUI } from "./FileUploadConnectorWorkflow.component";
export type { FileUploadConnectorWorkflowUIProps } from "./FileUploadConnectorWorkflow.component";
export { useUploadWorkflow } from "./utils/upload-workflow.util";

// Backwards compat re-exports (remove after all consumers updated)
export { FileUploadConnectorWorkflow as CSVConnectorWorkflow } from "./FileUploadConnectorWorkflow.component";
```

### 7.2 `UploadStep.component.tsx` Changes

**Accept prop:**
```ts
// Before:
accept=".csv"

// After:
accept=".csv,.xlsx"
```

**Helper text:**
```ts
// Before:
"Accepted formats: .csv (max 50MB per file, up to 5 files)"

// After:
"Accepted formats: .csv, .xlsx (max 50MB per file, up to 5 files)"
```

**Phase label:**
```ts
// Before:
"Parsing CSV files..."

// After:
"Parsing files..."
```

**Delimiter display:** The parse results panel shows delimiter info. For XLSX sheets, the delimiter is `"xlsx"` — display as "N/A (XLSX)" or omit the delimiter field entirely when not applicable:

```ts
function formatDelimiter(delimiter: string): string {
  if (delimiter === "xlsx") return "N/A";
  // existing comma/tab/semicolon/pipe formatting
}
```

**Sheet indicator:** When `fileName` contains `[SheetName]`, display the sheet name as a chip or subtitle under the file name in the parse results list.

### 7.3 `FileUploadConnectorWorkflow.component.tsx` Changes

**Modal title:**
```ts
// Before:
"CSV File Upload"

// After:
"File Upload"
```

**Step labels in `WORKFLOW_STEPS`** (`upload-workflow.util.ts`):
```ts
// Before:
{ label: "Upload CSV", description: "Select and upload CSV files" }

// After:
{ label: "Upload Files", description: "Select and upload files" }
```

### 7.4 `EntityStep.component.tsx` Changes

For XLSX multi-sheet uploads, each sheet becomes a separate entity. The existing UI already supports multiple entities (one per CSV file). The only change is cosmetic — the "Source file" label should show sheet context:

```ts
// Before:
"Source: data.csv"

// After (for XLSX):
"Source: data.xlsx — Sheet: Contacts"
```

Parse this from the `sourceFileName` format `"data.xlsx[Contacts]"`.

### 7.5 No Changes Required

These components are already format-agnostic:

- **`ColumnMappingStep.component.tsx`** — maps columns to definitions regardless of source format
- **`ReviewStep.component.tsx`** — reviews entities/columns/mappings regardless of source format
- **`utils/upload-workflow.util.ts`** — orchestrates upload/SSE/confirm flow generically (only step label text changes)
- **`utils/csv-validation.util.ts`** — validates entity keys and column mappings, not file format
- **`file-upload.util.ts`** (shared hook) — handles S3 presign/upload for any file type

---

## 8. File Inventory

### New Files (5)

| File | Layer | Purpose |
|------|-------|---------|
| `apps/api/src/utils/xlsx-parser.util.ts` | API | Stream XLSX from `Readable` → `FileParseResult` per sheet + per-sheet row iterator |
| `apps/api/src/utils/csv-parser.util.ts` | API | Stream CSV from `Readable` → `FileParseResult` + row iterator |
| `apps/api/src/utils/column-stats.util.ts` | API | Shared column statistics accumulator |
| `apps/api/src/services/xlsx-import.service.ts` | API | Stream XLSX sheet rows from S3 into shared importer |
| `apps/api/src/services/record-import.util.ts` | API | Shared async-iterable row normalization and batched upsert |

### Modified Files (9)

| File | Layer | Change |
|------|-------|--------|
| `apps/api/src/queues/processors/file-upload.processor.ts` | API | Remove buffer-collection; stream S3 into format-specific parser; flatten results |
| `apps/api/src/services/csv-import.service.ts` | API | Remove buffer-collection; stream S3 into `csvRowIterator` → `importRows` |
| `apps/api/src/services/uploads.service.ts` | API | Route import to CSV or XLSX service by extension |
| `apps/api/src/routes/uploads.router.ts` | API | Default allowed extensions `.csv,.xlsx` |
| `apps/api/src/queues/jobs.worker.ts` | API | Cap file-upload worker concurrency at 2 |
| `apps/api/Dockerfile` | Infra | Add `--max-old-space-size=3200` to node start command |
| `apps/web/src/workflows/CSVConnector/UploadStep.component.tsx` | Web | Accept `.xlsx`, update labels, handle XLSX delimiter display |
| `apps/web/src/workflows/CSVConnector/CSVConnectorWorkflow.component.tsx` | Web | Rename, update modal title and labels |
| `apps/web/src/workflows/CSVConnector/EntityStep.component.tsx` | Web | Display sheet name for XLSX entities |
| `apps/web/src/workflows/CSVConnector/utils/upload-workflow.util.ts` | Web | Update step label text |

### Renamed Files (4)

| Current | New |
|---------|-----|
| `workflows/CSVConnector/` | `workflows/FileUploadConnector/` |
| `CSVConnectorWorkflow.component.tsx` | `FileUploadConnectorWorkflow.component.tsx` |
| `__tests__/CSVConnectorWorkflow.test.tsx` | `__tests__/FileUploadConnectorWorkflow.test.tsx` |
| `stories/CSVConnectorWorkflow.stories.tsx` | `stories/FileUploadConnectorWorkflow.stories.tsx` |

### Config Changes (1)

| Change | Detail |
|--------|--------|
| `UPLOAD_ALLOWED_EXTENSIONS` default | `".csv"` → `".csv,.xlsx"` |

### Dependency Additions (1)

| Package | Location | Notes |
|---------|----------|-------|
| `exceljs` | `apps/api/package.json` | Streaming XLSX reader (MIT). Do **not** add `xlsx` / SheetJS CE. |

---

## 9. Multi-Sheet Mapping

The key architectural insight is how XLSX sheets map to the existing entity model:

```
CSV workflow (current):
  1 CSV file  →  1 FileParseResult  →  1 RecommendedEntity  →  1 ConnectorEntity

XLSX workflow (new):
  1 XLSX file  →  N FileParseResults (one per sheet)  →  N RecommendedEntities  →  N ConnectorEntities

Mixed upload (supported):
  2 CSV files + 1 XLSX (3 sheets)  →  5 FileParseResults  →  5 RecommendedEntities
```

The `sourceFileName` field preserves the origin:

| Source | `sourceFileName` | `entityKey` (auto-derived) |
|--------|------------------|---------------------------|
| CSV file `contacts.csv` | `"contacts.csv"` | `"contacts"` |
| XLSX sheet `Contacts` in `data.xlsx` | `"data.xlsx[Contacts]"` | `"contacts"` |
| XLSX sheet `Deal History` in `data.xlsx` | `"data.xlsx[Deal History]"` | `"deal_history"` |

Entity key derivation for XLSX sheets uses the **sheet name** (not the file name) run through `toSnakeCase()`.

---

## 10. Error Handling

### Parse-Time Errors

| Error | Handling |
|-------|----------|
| Password-protected XLSX | `parseXlsxStream` throws `ProcessorError("XLSX_PASSWORD_PROTECTED", "...")` — exceljs surfaces encrypted-workbook errors during stream open |
| Corrupted/invalid XLSX | Catch exceljs stream errors and rethrow as `ProcessorError("XLSX_PARSE_FAILED", "...")` |
| No data sheets (all empty) | `parseXlsxStream` yields nothing; processor checks the flattened result length and throws `ProcessorError("XLSX_NO_DATA", "No sheets with data found")` |
| Sheet with 0 columns | Skip sheet (same as empty) |
| Extremely wide sheets (>500 columns) | Truncate to first 500 columns with warning in parse result |
| CSV stream read error | Propagate as `ProcessorError("CSV_PARSE_FAILED", "...")` |

### Import-Time Errors

| Error | Handling |
|-------|----------|
| Sheet not found in XLSX during import | `xlsxSheetRowIterator` throws `ApiError(400, "UPLOAD_SHEET_NOT_FOUND", "...")` |
| Sheet modified between parse and import | Unlikely (file is immutable in S3), but checksum comparison catches row-level changes |
| Stream consumer error mid-import | Partial batch is flushed or rolled back per transaction; error propagates to the caller |

### Existing Error Handling (unchanged)

- S3 file not found → `ProcessorError`
- File too large → presign route rejects
- Invalid extension → presign route rejects
- AI analysis timeout → falls back to heuristic analyzer
- Confirmation transaction failure → rolls back, returns error

---

## 11. Testing Strategy

### Unit Tests

| Test File | Scope |
|-----------|-------|
| `utils/xlsx-parser.util.test.ts` | Stream single-sheet, multi-sheet, empty-sheet skipping, date/boolean cells, unicode sheet names, >500 column truncation, corrupted/password-protected errors. Fixtures built in-memory via exceljs writer; fed in as `Readable.from(buffer)`. |
| `utils/csv-parser.util.test.ts` | Stream rows, encoding/delimiter detection with a 64 KB tap, empty file, header-only file, wide rows |
| `utils/column-stats.util.test.ts` | Accumulator create/update/finalize (extracted from existing processor tests) |
| `services/xlsx-import.service.test.ts` | Streams sheet rows from mocked S3 into `importRows`; throws `UPLOAD_SHEET_NOT_FOUND` for missing sheet |
| `services/record-import.util.test.ts` | Consumes async iterables: batching at 500, empty iterable, error propagation, created/updated/unchanged/invalid counts |

### Integration Tests

| Test | Scope |
|------|-------|
| `file-upload.processor.test.ts` | Add XLSX cases: single-sheet, multi-sheet, mixed CSV+XLSX upload. Sanity-check that `process.memoryUsage().heapUsed` stays bounded when parsing a 50k-row CSV fixture (streaming smoke test, not a strict gate). |
| `uploads.service.test.ts` | Add XLSX confirm case with sheet name resolution |

### Frontend Tests

| Test | Scope |
|------|-------|
| `UploadStep.test.tsx` | Verify `.xlsx` accepted, delimiter "N/A" display, sheet name display |
| `EntityStep.test.tsx` | Verify sheet name rendering for XLSX entities |
| `FileUploadConnectorWorkflow.test.tsx` | End-to-end workflow with XLSX mock data |

### Test Fixtures

No binary XLSX fixtures are committed. A helper at `apps/api/src/__tests__/utils/xlsx-fixtures.util.ts` builds XLSX buffers in-memory using the exceljs writer, then wraps them in `Readable.from(buffer)` for the unit-under-test. This keeps the repository clean and the fixture shape explicit in each test.

Helper signatures:

```ts
export async function buildSingleSheetXlsx(sheetName: string, rows: string[][]): Promise<Buffer>;
export async function buildMultiSheetXlsx(sheets: Record<string, string[][]>): Promise<Buffer>;
export function toStream(buffer: Buffer): Readable;  // thin wrapper for clarity
```

Test cases exercised via the helper:

| Scenario | Inputs |
|----------|--------|
| Single-sheet | 1 sheet, 10 rows, 5 columns (string, number, date, boolean, email) |
| Multi-sheet | 3 sheets (Contacts, Companies, Deals), varying column counts |
| Empty-sheet skipping | 1 empty sheet + 1 data sheet |
| Special characters | Sheet names with spaces, unicode, brackets |
| Wide sheet truncation | 1 sheet with 600 columns |
| Corrupted workbook | Buffer with a bad XLSX magic-byte prefix |
| Password-protected | Encrypted workbook buffer (built via exceljs `password` option) |

---

## 12. Implementation Order

Work is organized to deliver incremental, testable milestones.

### Phase 1: Streaming Refactor (no XLSX yet, no frontend changes)

1. **Extract `column-stats.util.ts`** from `file-upload.processor.ts` — pure refactor, existing tests pass
2. **Extract `csv-parser.util.ts`** with streaming `parseCsvStream` + `csvRowIterator` — replaces `parseCSVBuffer`; existing processor tests pass
3. **Extract `record-import.util.ts`** with async-iterable `importRows` — existing csv-import tests pass (adapter wraps materialized arrays as async iterables during the transition)
4. **Convert `file-upload.processor.ts` to stream** — remove `Buffer.concat`, feed S3 `Readable` into `parseCsvStream`
5. **Convert `csv-import.service.ts` to stream** — remove buffer loop, feed S3 `Readable` into `csvRowIterator` → `importRows`

### Phase 2: XLSX Support

6. **Add `exceljs` dependency** to `apps/api`
7. **Implement `xlsx-parser.util.ts`** streaming parser + row iterator with tests
8. **Implement `xlsx-import.service.ts`** with tests
9. **Update `file-upload.processor.ts`** — extension routing to XLSX parser, flatten results
10. **Update `uploads.service.ts`** — route to XLSX import service
11. **Update allowed extensions** config default → `.csv,.xlsx`
12. **Infra updates** — Dockerfile `--max-old-space-size=3200`, BullMQ concurrency cap at 2
13. **Integration tests** — end-to-end XLSX upload + confirm; large-file heap sanity check

### Phase 3: Frontend Generalization

14. **Rename workflow** directory and files
15. **Update `UploadStep`** — accept, labels, delimiter display, sheet names
16. **Update container** — title, step labels
17. **Update `EntityStep`** — sheet name display
18. **Update tests and stories**
19. **Update any external references** to the old `CSVConnectorWorkflow` export name

---

## 13. Rollback Strategy

Each phase is independently deployable, with one caveat:

- **Phase 1 is a behavior change on the hot CSV path**, not a pure refactor. The streaming conversion must be validated under production-like load before Phase 2 ships. If it regresses, revert `file-upload.processor.ts` and `csv-import.service.ts` to the buffered implementation; the extracted utilities (`column-stats.util.ts`, `csv-parser.util.ts`, `record-import.util.ts`) can remain in place unused.
- **Phase 2** is gated by `UPLOAD_ALLOWED_EXTENSIONS` — set to `.csv` only to disable XLSX without code changes. The XLSX parser/service code can remain deployed but unreachable.
- **Phase 3** is cosmetic — backwards-compat re-exports prevent breakage during transition.

To disable XLSX after deployment: set `UPLOAD_ALLOWED_EXTENSIONS=.csv` in environment config. No code revert needed.
