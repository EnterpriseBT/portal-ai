# XLSX imports drop sheets and shared strings — Condensed design (#997)

**Issue:** [EnterpriseBT/portal-ai#997](https://github.com/EnterpriseBT/portal-ai/issues/997) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #997 reports text cells importing as `[object Object]`. The survey found the cause is wider: ExcelJS' streaming `WorkbookReader` races whenever a workbook's sheets precede `xl/sharedStrings.xml` in the zip, and it then **drops whole sheets** as well as leaving strings unresolved. Twenty reads of our own sample (`supported_layouts.xlsx`, 11 sheets, 142 rows) returned 7, 8, 9 or 11 sheets, and no run resolved every string. That order is what ExcelJS itself writes, and likely what Excel writes too. The same file with `sharedStrings.xml` and `styles.xml` moved ahead of the sheets read 11 sheets, 142 rows and 0 unresolved strings in 20 of 20 runs. Package: `apps/api` only. No contract change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Streaming reader | `apps/api/src/services/workbook-adapters/xlsx.adapter.ts:142` | `new WorkbookReader(source, { sharedStrings: "cache", styles: "cache", worksheets: "emit" })` over a one-shot `Readable` |
| Cell coercion | `xlsx.adapter.ts:50` (`coerceCell`) | handles `richText` / `text` / `result`; anything else becomes `String(raw)` → `[object Object]` |
| The race | `node_modules/exceljs/lib/stream/xlsx/workbook-reader.js:107-147` | a sheet seen before shared strings is spooled to a temp file and parsed after the zip loop; entries are lost or parsed early along that path |
| Callers | `file-upload-session.service.ts:159`; `microsoft-excel-connector.service.ts:334, 544, 660` | file upload and the Microsoft Excel connector both stream through the adapter |
| Tests | `apps/api/src/__tests__/services/workbook-adapters/xlsx-adapter.test.ts:14-22` | already saw the race ("flakes ~5-25%"), assumed it was fixture-only, and retries 3 times |

## Decision — give ExcelJS the zip in an order it reads deterministically

- **A. Spool, then stream the entries metadata-first (chosen).** Write the source to a temp file. Read its central directory (`unzipper.Open.file`) and build a stream of the zip's local entries, copied byte for byte, with `[Content_Types].xml`, `_rels/*`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/sharedStrings.xml` and `xl/styles.xml` first and every other entry after, in its original order. ExcelJS reads that stream through its public API unchanged. Raw copying means no re-compression and no full-workbook memory. The cost is one sequential disk write and read of the compressed file, which is bounded by the 250 MB upload limit. ExcelJS already spools sheets to temp files on the failing path.
- B. Drive ExcelJS internals (`_parseSharedStrings`, `_parseWorksheet`) from a random-access unzip: couples us to underscore methods of an unmaintained dependency.
- C. `workbook.xlsx.readFile` (non-streaming): holds the whole workbook in memory, which is what the streaming adapter exists to avoid.
- D. Our own XLSX parser: shared strings, styles-based date detection, inline strings and formulas. Too much surface for a bug fix.

Two guards make any future regression loud rather than silent:
- `coerceCell` resolves a `{ sharedString: n }` it shouldn't see by throwing `XLSX_PARSE_FAILED`, rather than storing `[object Object]`. It also maps a formula error (`{ error }`) to its text and a formula with no cached result to `null`. Any other unknown object shape throws too.
- After the stream, the adapter checks the emitted sheet count against `xl/workbook.xml`'s sheets and throws `XLSX_PARSE_FAILED` on a shortfall.

The temp file is removed in a `finally`, so a failed parse doesn't leak it.

## Plan — 1 slice

**Files**
- Edit: `apps/api/src/services/workbook-adapters/xlsx.adapter.ts`: spool, the metadata-first entry stream, the `coerceCell` cases, the sheet-count check.
- New: `apps/api/src/services/workbook-adapters/xlsx-entry-order.util.ts`: the central-directory read and local-entry copy, plus its local-header and data-descriptor arithmetic.
- Edit: `apps/api/package.json`: declare `unzipper`, which is only ExcelJS' transitive dependency today (the API image builds from declared deps).
- Edit: `xlsx-adapter.test.ts`: drop `jest.retryTimes(3)` and its comment.

**Tests** (`cd apps/api && npm run test:unit -- --testPathPattern workbook-adapters`)
- The app's sample read 20 times: 11 sheets and 142 rows every time, no cell `[object Object]`, and the "Single Axis Static - Table 1" header reads `employee_id`.
- A fixture written by ExcelJS (sheets before shared strings) with shared strings across 3 sheets: every sheet and every string comes through.
- The entry-order util: the output stream parses with `unzipper.Parse` to the same entries and bytes as the input. Metadata comes first, and an entry with a data descriptor survives.
- `coerceCell`: `{ error: "#N/A" }` → `"#N/A"`, `{ formula }` with no result → `null`, `{ sharedString: 3 }` → throws `XLSX_PARSE_FAILED`.
- A truncated or non-zip source still fails as `XLSX_PARSE_FAILED`, and the temp file is gone afterwards.

## Smoke (manual, against your dev stack)

1. Connectors → File Upload → upload `supported_layouts.xlsx` from the Sample files. All 11 sheet tabs appear. Repeat the upload 3 times: always 11.
2. "Single Axis Static - Table 1": cells read `employee_id`, `Alice Nguyen` and so on, never `[object Object]`.
3. Draw a region over that table with a row header axis and Interpret: bindings are proposed (confidence above 0%).
4. Upload a workbook saved from Excel with text on several sheets: every sheet and its text come through.
5. Upload a `.xlsx` that's really a renamed text file: the upload fails with the parse error, not a 500.

## Out of scope

- An upstream ExcelJS fix (the project hasn't released since 4.4.0); the workaround stays until one ships.
- Merged-cell metadata, still dropped on the streaming path, as before.
