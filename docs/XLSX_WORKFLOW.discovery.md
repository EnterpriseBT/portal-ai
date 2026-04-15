# XLSX Workflow — Discovery Notes

> Companion to `XLSX_WORKFLOW.spec.md` and `XLSX_WORKFLOW.plan.md`. This document captures the investigation and decisions behind the design — library choice, memory model, and what we learned about the existing CSV pipeline while planning XLSX support.

---

## 1. Scaling Question

Production will raise both `UPLOAD_MAX_FILES` and `UPLOAD_MAX_FILE_SIZE_MB` beyond today's 5-file / 50 MB ceiling. This forced a second look at whether the originally proposed library (SheetJS Community, `xlsx`) would hold up — and, once we looked, whether the existing CSV path was any better.

**Answer: neither was.** Both buffered whole files into RAM. At 50 MB that's fine; at 500 MB it's an OOM.

## 2. Current Pipeline Is Fully Buffered

What we expected to find vs. what's actually in the code:

| Location | Expected | Actual |
|---|---|---|
| `file-upload.processor.ts:189-206` | Streams S3 → parser | `for await (chunk of s3Stream) { allChunks.push(chunk) }` → `Buffer.concat(allChunks)` |
| `csv-import.service.ts:110-116` | Streams S3 → parser | Same buffer-everything pattern |
| `parseCSVBuffer(buffer, delimiter)` | Streaming `csv-parse` | Async `csv-parse`, but fed from a full buffer; returns `string[][]` — whole file in memory twice |
| `EntityRecords` upsert loop | Flushes as rows arrive | Iterates a fully-materialized `dataRows` array |

`S3Service.getObjectStream()` already returns a `Readable` — we've simply been consuming it into a buffer and throwing the streaming nature away.

## 3. Memory Cost Comparison

A 50 MB CSV is roughly 50 MB of string data. A 50 MB `.xlsx` is a zip archive of XML — once decompressed, parsed into cell objects, and cross-referenced against the shared-strings table, peak heap can run 5–10× the input size.

| File size | CSV peak heap (buffered) | SheetJS `xlsx` peak heap | Streaming (either format) |
|---|---|---|---|
| 50 MB | ~200–300 MB | ~400–600 MB | <100 MB |
| 100 MB | ~400–500 MB | ~800 MB–1.2 GB | <100 MB |
| 200 MB | ~1 GB+ | ~2 GB+ (OOM on default Node heap) | <100 MB |
| 500 MB | OOM on default heap | OOM | <100 MB |

Node's default heap on 64-bit is ~2 GB. The API's Dockerfile sets no `--max-old-space-size` override.

## 4. Library Choice: `exceljs` (not SheetJS `xlsx`)

SheetJS Community is **whole-workbook only**. Streaming XLSX reads are a paid Pro feature. `exceljs` is MIT-licensed and ships a streaming reader (`ExcelJS.stream.xlsx.WorkbookReader`) in its free package. That single property decided the choice.

| Criterion | SheetJS `xlsx` (CE) | `exceljs` |
|---|---|---|
| Streaming XLSX read | ❌ Pro only | ✅ `WorkbookReader` over a `Readable` |
| Memory profile | Whole workbook in RAM | Constant per sheet |
| License | Apache 2.0 | MIT |
| Formats | `.xlsx`, `.xls`, `.xlsb`, `.ods` | `.xlsx`, `.csv` |
| API ergonomics | Synchronous `XLSX.read(buffer)` | `for await (const ws of workbook)` / `for await (const row of ws)` |
| Node type defs | Ships own types | Ships own types |

CSV parsing stays on `csv-parse` — already a dependency, already supports streaming mode, we just stop feeding it a pre-materialized buffer.

## 5. Decision: Stream Both Formats

Once we were rewriting the XLSX path to be streaming, leaving CSV buffered would have meant two different memory models in the same processor. Instead, the refactor unifies both:

```
S3 Readable → format-specific row iterator (AsyncIterable<Record<string,string>>) → shared importRows()
                                                                                  → batch-flush every 500 rows
```

- `parseCsvStream(readable)` → `FileParseResult` (headers, sample rows, column stats) with constant memory
- `parseXlsxStream(readable)` → `AsyncIterable<FileParseResult>` (one yield per sheet)
- `importRows(asyncIterable, params)` — shared, format-agnostic, drives both `CsvImportService` and `XlsxImportService`

This is why `record-import.util.ts` in the spec takes `AsyncIterable<Record<string,string>>` rather than `Record<string,string>[]`.

## 6. Infra Implications

Streaming caps per-job peak memory, but concurrent jobs still compete for the same heap. The full picture:

1. **Node heap**: Set `--max-old-space-size=3200` in the Dockerfile `CMD`. Headroom for XLSX zip decompression spikes and concurrent workers.
2. **BullMQ concurrency**: Keep file-upload worker concurrency at 2. Streaming makes single-file memory predictable; concurrency is the remaining variable.
3. **Container memory**: ≥4 GB for production.
4. **Upload limits**: The config knobs (`UPLOAD_MAX_FILE_SIZE_MB`, `UPLOAD_MAX_FILES`) are now the user-facing throttle. Raise them in env, not in code.

## 7. What We Are Explicitly Not Doing

- **Not switching to SheetJS Pro.** The MIT `exceljs` streaming reader is sufficient.
- **Not adding `.xls` support.** Legacy binary format; add later with the same streaming pattern if needed.
- **Not client-side parsing.** Files are server-parsed only. Frontend just uploads to S3 presigned URLs.
- **Not formula evaluation.** `exceljs` returns resolved values.
- **Not pivot tables / charts / macros.** Ignored during parse.
- **Not sheet selection UI.** Every non-empty sheet becomes an entity; the user reviews/renames in Step 1 of the workflow.
- **Not streaming row parsing on the client.** S3 presigned upload is already streaming from the browser's perspective.

## 8. What Changed Relative To Original Plan

Before this discovery round, the plan installed `xlsx`, used `XLSX.read(buffer, ...)`, and left the CSV path untouched. After:

| Area | Before | After |
|---|---|---|
| XLSX library | `xlsx` (SheetJS CE) | `exceljs` (streaming `WorkbookReader`) |
| XLSX parse input | `Buffer` | `Readable` stream |
| CSV parse input | `Buffer` (unchanged) | `Readable` stream (new) |
| Import pipeline signature | `importRows(rows: Record<string,string>[])` | `importRows(rows: AsyncIterable<Record<string,string>>)` |
| CSV import service | Kept buffer-collection loop | Streams S3 → `csv-parse` directly |
| Dockerfile | Default Node heap | `--max-old-space-size=3200` |
| Worker concurrency | Default | Capped at 2 for file-upload jobs |

The spec (§3, §4, §5) and plan (steps 3–6, plus a new streaming-CSV extraction step) are updated accordingly.
