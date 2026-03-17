# FILE_UPLOAD Feature

## Overview

CSV file upload connector that allows users to upload CSV files, automatically analyzes their contents using AI, recommends schema mappings to existing or new column definitions, and persists the data — all via a non-blocking background job pipeline with real-time SSE progress updates.

---

## User Workflow

1. User clicks **Connect** → modal opens with a file uploader
2. User selects one or more `.csv` files and submits
3. Frontend uploads files to API, receives a **job ID** immediately
4. Backend parses each file in a background job, streams progress via SSE
5. AI analyzes headers/sample rows and recommends:
   - Connector instance config (delimiter, headers_present, encoding, row count)
   - Column definitions (new or matched to existing)
   - Connector entities and field mappings
6. Frontend receives recommendations via SSE, presents them for user review
7. User confirms or modifies recommendations
8. Frontend submits confirmed config → backend persists all records in a transaction
9. SSE streams final completion status

---

## Architecture

### High-Level Flow

```
┌─────────┐  GET /api/uploads/presign  ┌──────────┐  presigned URL  ┌────────┐
│ Frontend │ ─────────────────────────→ │ API      │ ──────────────→ │   S3   │
│          │  ← { url, key, jobId }     │ Server   │                 │ Bucket │
│          │                            └──────────┘                 └────┬───┘
│          │  PUT <presigned-url>                                         │
│          │ ────────────────────────────────────────────────────────────→│
│          │  ← 200                                                      │
│          │                                                             │
│          │  POST /api/uploads/:jobId/process  ┌──────────┐  enqueue    │
│          │ ─────────────────────────────────→  │ API      │ ──→ ┌──────┴─────┐
│          │  ← 202 { jobId }                    │ Server   │     │  BullMQ    │
│          │                                     └──────────┘     │  Queue     │
│          │                                                      └──────┬─────┘
│          │  SSE /sse/jobs/:id/events                                   │
│          │ ←──────────────────────────────────────────────── ┌─────────▼────┐
│          │  (progress, recommendations, completion)          │ Job Worker   │
│          │                                                   │              │
│          │  POST /api/uploads/:jobId/confirm                 │ ┌──────────┐ │
│          │ ───────────────────────────────────────────────→   │ │ AI Agent │ │
│          │  ← 200 { created entities }                       │ └──────────┘ │
└─────────┘                                                    └──────────────┘
```

### Phase Breakdown

The file upload job processor executes in discrete phases, each reported via SSE:

| Phase | SSE Event | Description |
|-------|-----------|-------------|
| 1. **Upload** | `progress: 5` | Files uploaded to S3 via presigned URL, job created |
| 2. **Parse** | `progress: 10-30` | CSV streamed from S3 and parsed: detect delimiter, headers, encoding, row count, sample rows |
| 3. **Analyze** | `progress: 30-70` | AI agent analyzes schema, matches to existing column definitions |
| 4. **Recommend** | `progress: 70-80` | Recommendations assembled and emitted via SSE `result` field |
| 5. **Await Confirm** | `status: awaiting_confirmation` | Job pauses, waits for user confirmation or modification |
| 6. **Persist** | `progress: 80-100` | Confirmed entities created/updated in a single transaction |
| 7. **Complete** | `status: completed` | Final summary emitted |

---

## API Endpoints

### `POST /api/uploads/presign`

Request presigned S3 URLs for direct browser-to-S3 uploads. Creates a pending job and returns upload URLs.

**Auth**: JWT (Bearer token)
**Content-Type**: `application/json`

```json
{
  "organizationId": "org_xyz",
  "connectorDefinitionId": "cdef_csv01",
  "files": [
    { "fileName": "contacts.csv", "contentType": "text/csv", "sizeBytes": 204800 }
  ]
}
```

**Response** `200 OK`
```json
{
  "jobId": "job_abc123",
  "uploads": [
    {
      "fileName": "contacts.csv",
      "s3Key": "uploads/org_xyz/job_abc123/contacts.csv",
      "presignedUrl": "https://bucket.s3.region.amazonaws.com/uploads/org_xyz/job_abc123/contacts.csv?X-Amz-...",
      "expiresIn": 900
    }
  ]
}
```

The frontend uploads each file directly to S3 using the presigned PUT URL. This keeps large files off the API server and allows parallel uploads.

### `POST /api/uploads/:jobId/process`

Signal that all files have been uploaded to S3 and processing should begin.

**Auth**: JWT (Bearer token)
**Content-Type**: `application/json`

```json
{}
```

**Response** `202 Accepted`
```json
{
  "job": {
    "id": "job_abc123",
    "type": "file_upload",
    "status": "pending",
    "progress": 0,
    "metadata": {
      "files": [
        { "originalName": "contacts.csv", "s3Key": "uploads/org_xyz/job_abc123/contacts.csv", "sizeBytes": 204800 }
      ],
      "organizationId": "org_xyz",
      "connectorDefinitionId": "cdef_csv01"
    }
  }
}
```

### `POST /api/uploads/:jobId/confirm`

Submit user-confirmed (or modified) recommendations to persist.

**Auth**: JWT (Bearer token)
**Content-Type**: `application/json`

```json
{
  "connectorInstance": {
    "name": "Q1 Contacts Import",
    "config": { "delimiter": ",", "hasHeader": true, "encoding": "utf-8" }
  },
  "entities": [
    {
      "connectorEntity": { "key": "contacts", "label": "Contacts" },
      "columnDefinitions": [
        { "id": "existing_col_id_1" },
        { "key": "phone_number", "label": "Phone Number", "type": "string", "required": false }
      ],
      "fieldMappings": [
        { "sourceField": "Full Name", "columnDefinitionKey": "full_name", "isPrimaryKey": false },
        { "sourceField": "Phone", "columnDefinitionKey": "phone_number", "isPrimaryKey": false }
      ]
    }
  ]
}
```

**Response** `200 OK`
```json
{
  "connectorInstance": { "id": "ci_new123", "..." : "..." },
  "entities": [
    {
      "connectorEntity": { "id": "ce_new1", "..." : "..." },
      "columnDefinitions": [ "..." ],
      "fieldMappings": [ "..." ]
    }
  ]
}
```

### `GET /sse/jobs/:id/events`

Existing SSE endpoint. Events for file upload jobs include:

- **`job:snapshot`** — Full job state on initial connect
- **`job:update`** — Progress/status transitions during processing
- **`job:recommendations`** — AI-generated recommendations (emitted once, during phase 4)
- **`job:error`** — Error details if a phase fails
- **`job:complete`** — Final summary with created entity IDs

---

## S3 File Storage

### Bucket Structure

```
s3://{UPLOAD_S3_BUCKET}/
  uploads/
    {orgId}/
      {jobId}/
        {original-filename}.csv      ← raw uploaded file
```

Files are organized by org and job to enable easy cleanup and access control. The job ID directory ensures no collisions between uploads.

### Upload Flow (Presigned URLs)

The API never handles file bytes directly. Instead:

1. **Frontend** calls `POST /api/uploads/presign` with file metadata
2. **API** validates file count/size/extension, creates a `pending` job, generates S3 presigned PUT URLs (15-minute expiry)
3. **Frontend** uploads each file directly to S3 using the presigned URL via `PUT` with `Content-Type: text/csv`
4. **Frontend** calls `POST /api/uploads/:jobId/process` to signal uploads are complete
5. **API** verifies all expected files exist in S3 (HeadObject), then enqueues the job

This approach:
- Keeps large files off the API server (no memory/disk pressure)
- Allows parallel file uploads from the browser
- Leverages S3's built-in durability and availability
- Enables direct S3 streaming during the parse phase

### Download Flow (Presigned URLs)

If the frontend needs to re-download a file (e.g., for preview), the API generates a short-lived presigned GET URL. Files are never proxied through the API.

### S3 Service: `s3.service.ts`

```typescript
class S3Service {
  // Generate presigned PUT URL for browser upload
  static async createPresignedUpload(s3Key: string, contentType: string, expiresIn?: number): Promise<string>;

  // Generate presigned GET URL for browser download
  static async createPresignedDownload(s3Key: string, expiresIn?: number): Promise<string>;

  // Check if object exists (used to verify uploads before processing)
  static async headObject(s3Key: string): Promise<{ contentLength: number; contentType: string } | null>;

  // Get readable stream for job processor to parse CSV
  static async getObjectStream(s3Key: string): Promise<Readable>;

  // Delete all objects under a prefix (cleanup on job cancellation)
  static async deletePrefix(prefix: string): Promise<void>;
}
```

### Lifecycle & Cleanup

| Event | Action |
|-------|--------|
| Job completed | Files retained per retention policy (default 30 days) |
| Job cancelled | Files deleted immediately via `S3Service.deletePrefix()` |
| Job failed (all retries exhausted) | Files retained for debugging, cleaned up by lifecycle rule |
| Retention expiry | S3 lifecycle rule auto-deletes objects older than `UPLOAD_S3_RETENTION_DAYS` |

Configure an S3 lifecycle rule on the `uploads/` prefix to auto-expire objects:

```json
{
  "Rules": [{
    "ID": "expire-uploads",
    "Prefix": "uploads/",
    "Status": "Enabled",
    "Expiration": { "Days": 30 }
  }]
}
```

---

## Large File Handling

The architecture is designed to handle files from a few KB up to the configured max (default 50MB) without loading entire files into memory at any layer.

### Upload Layer

Presigned URLs offload all file transfer to S3. The API server never buffers file bytes — even a 50MB file costs zero API memory. The browser handles upload progress natively via `XMLHttpRequest.upload.onprogress` or the Fetch `ReadableStream` API.

### Parse Layer — Single-Pass Streaming

The job processor uses a **single-pass streaming parser** with constant memory overhead:

```
S3 GetObject (stream) → chardet (first 4KB) → csv-parse (row by row) → accumulators
```

**During the single pass, the processor collects:**

| Data | Strategy | Memory Bound |
|------|----------|-------------|
| Sample rows | Buffer first N rows (default 50), then stop collecting | O(N) — fixed |
| Row count | Increment counter | O(1) |
| Null rate per column | Running count of nulls / total rows | O(columns) |
| Unique count per column | `Set` per column, capped at `UPLOAD_STATS_UNIQUE_CAP` (default 1,000). Once the cap is hit, stop adding to the set and mark the stat as `"capped"` | O(columns * cap) |
| Min/max length per column | Running min/max | O(columns) |
| Sample values per column | First 10 distinct non-null values | O(columns * 10) |

**No second pass is required.** Row count, column stats, and sample rows are all captured in one stream traversal.

### Progress Reporting

Progress during the parse phase is **byte-based**, not row-based, since the total row count is unknown until the stream completes:

```typescript
const totalBytes = headObjectResult.contentLength;
let bytesRead = 0;

s3Stream.on('data', (chunk: Buffer) => {
  bytesRead += chunk.length;
  const progress = 10 + Math.round((bytesRead / totalBytes) * 20); // maps to 10-30 range
  jobEvents.updateProgress(jobId, progress);
});
```

This gives smooth, predictable progress updates regardless of row size variation.

### Memory Budget

For a 50MB CSV with 100 columns, worst-case memory consumption of the streaming accumulators:

| Component | Estimate |
|-----------|----------|
| 50 sample rows * 100 cols * ~100 bytes avg | ~500 KB |
| 100 column stat accumulators * 1,000 uniques * ~50 bytes | ~5 MB |
| csv-parse internal buffer | ~64 KB |
| S3 stream buffer (Node default highWaterMark) | ~16 KB |
| **Total** | **~6 MB** |

This is well within the BullMQ worker memory budget, even with concurrency of 5.

---

## Multi-File & File-to-Entity Mapping

### One File = One Connector Entity

Each uploaded file maps to exactly one connector entity. When a user uploads N files, the system produces N connector entities under a single connector instance:

```
Upload: [contacts.csv, products.csv, orders.csv]
                    │
                    ▼
Connector Instance: "Q1 Data Import"
  ├── Entity: "contacts"  ← contacts.csv
  │     ├── ColumnDef: full_name (string)
  │     ├── ColumnDef: email (string)
  │     └── FieldMapping: "Full Name" → full_name
  ├── Entity: "products"  ← products.csv
  │     ├── ColumnDef: sku (string)
  │     ├── ColumnDef: price (currency)
  │     └── FieldMapping: "SKU" → sku
  └── Entity: "orders"    ← orders.csv
        ├── ColumnDef: order_id (string)
        ├── ColumnDef: total (currency)
        └── FieldMapping: "Order ID" → order_id
```

### Per-File Processing

The job processor iterates files sequentially within a single job (not parallel workers), because:
- Files often share column definitions (e.g., `email` appears in both contacts and orders)
- The AI analysis for file N benefits from knowing what was already matched in files 1..N-1
- A single job allows atomic progress tracking and a unified recommendation payload

```
for each file in job.metadata.files:
  1. Stream & parse from S3            → parseResult[i]
  2. AI analyze (with cumulative context) → recommendation.entities[i]
  update progress: 10 + (i / fileCount) * 60   // spreads 10-70 across files
```

### Column Definition Sharing Across Files

Column definitions are **org-scoped**, not entity-scoped. When the AI encounters `email` in both `contacts.csv` and `orders.csv`:

- First file: Creates new column definition recommendation `{ key: "email", type: "string" }`
- Second file: Matches existing recommendation with `action: "match_existing"`, reuses the same column definition
- The AI receives cumulative context: existing org columns + columns already recommended in prior files within this job

This prevents duplicate column definitions and encourages a normalized schema.

### Recommendation Payload Structure

The `entities` array in `FileUploadRecommendationSchema` directly maps to the files array by index:

```typescript
// recommendation.entities[0] corresponds to job.metadata.files[0]
// recommendation.entities[1] corresponds to job.metadata.files[1]
// etc.
```

Each entity has its own `connectorEntity`, `columns`, and field mappings. The user can review and modify each file's mappings independently in the UI.

---

## XLSX Support (Future)

### Current Scope: CSV Only

The initial implementation accepts only `.csv` files. This keeps the parser simple and avoids the complexity of Excel-specific features (formulas, merged cells, formatting, multiple sheets).

### Future: XLSX Multi-Sheet Decomposition

When XLSX support is added, the architecture accommodates it with a **sheet decomposition step** inserted before the existing parse phase:

```
Phase 1.5 — Sheet Decomposition (XLSX only)
  1. Stream .xlsx from S3
  2. Use exceljs (streaming mode) to enumerate sheets
  3. Export each sheet as an in-memory CSV stream
  4. Feed each sheet-CSV into the existing parse pipeline as a virtual file

Upload: [data.xlsx] (3 sheets: "Contacts", "Products", "Orders")
                    │
                    ▼  decompose
Virtual files: [contacts.csv, products.csv, orders.csv]
                    │
                    ▼  (same pipeline as multi-CSV upload)
Connector Instance → 3 Entities → Column Defs → Field Mappings
```

### Design Decisions for XLSX

| Concern | Approach |
|---------|----------|
| Sheet selection | Default: process all sheets. Allow user to select/deselect sheets in the recommendation review UI |
| Empty sheets | Skip sheets with 0 data rows, log a warning |
| Merged cells | Unmerge and fill down/right before export. Flag in recommendations as `"hasMergedCells": true` |
| Formulas | Export computed values only, ignore formulas |
| Max sheet size | Same per-file limit applies per sheet (50MB exported CSV equivalent) |
| File extensions | Add `.xlsx`, `.xls` to `UPLOAD_ALLOWED_EXTENSIONS` |
| Content-Type | Accept `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` in presign |

### Processor Interface: Format-Agnostic

To prepare for XLSX without over-building now, the processor uses an intermediate `ParsedFileInput` abstraction:

```typescript
interface ParsedFileInput {
  fileName: string;          // original file or "file.xlsx/SheetName"
  s3Key: string;             // S3 location of source file
  sheetName?: string;        // populated for XLSX sheets
  getStream(): Promise<Readable>;  // returns CSV-compatible stream
}
```

For CSV files, `getStream()` returns the raw S3 stream. For future XLSX, `getStream()` returns a per-sheet CSV stream from the decomposer. The downstream parse + analyze phases are identical regardless of source format.

### Dependencies (Future)

| Package | Purpose |
|---------|---------|
| `exceljs` | XLSX parsing with streaming WorkbookReader |

---

## Job Processor: `file_upload.processor.ts`

### Registration

```typescript
// queues/processors/index.ts
export const processors: ProcessorMap = {
  file_upload: fileUploadProcessor,
  system_check: systemCheckProcessor,
};
```

### Processor Phases

#### Phase 1 — S3 Verification

- Verify all expected files exist in S3 via `S3Service.headObject()` for each `s3Key` in job metadata
- Validate actual file sizes match declared sizes
- Validate content is not empty (contentLength > 0)
- **Error**: `UPLOAD_FILE_MISSING` (file not found in S3), `UPLOAD_FILE_SIZE_MISMATCH`, `UPLOAD_EMPTY_FILE`

#### Phase 2 — CSV Parsing (per file, sequential)

For each file in `job.metadata.files`, stream from S3 via `S3Service.getObjectStream()` and pipe through a CSV parser (e.g., `csv-parse`) in a single pass to:

- Auto-detect delimiter (comma, tab, semicolon, pipe) from first 4KB
- Detect header row presence
- Detect encoding via `chardet` on first 4KB
- Count total rows (running counter)
- Capture first N sample rows (configurable, default 50)
- Compute per-column statistics with bounded memory: null rate, unique count (capped at 1,000), min/max length, sample values (first 10 distinct)
- Report byte-based progress via SSE: `progress = 10 + (fileIndex / fileCount) * 20`

Emit progress updates as bytes stream in.

**Error**: `UPLOAD_PARSE_FAILED`, `UPLOAD_EMPTY_FILE`, `UPLOAD_ENCODING_ERROR`

#### Phase 3 — AI Analysis (LangChain/LangGraph)

The AI is invoked **once per file**, sequentially, with cumulative context so that later files benefit from earlier matches.

**Input context (per file):**
- Parsed headers and sample rows for this file
- Per-column statistics from Phase 2 for this file
- Existing column definitions for the organization (fetched from DB)
- Column definitions already recommended by prior files in this job (cumulative)
- Existing connector entities for the organization

**AI tasks:**
1. **Infer column types** — For each CSV header, recommend a `ColumnDataType` (string, number, boolean, date, datetime, currency, enum, etc.)
2. **Match existing columns** — Compare CSV headers against existing `column_definitions` by key similarity, label similarity, and sample value compatibility. Use a confidence score threshold (e.g., 0.8) to auto-match vs. flag for review.
3. **Suggest new columns** — For unmatched headers, generate `key` (snake_case), `label`, `type`, `required`, `format`, `enumValues` recommendations
4. **Recommend entity key** — Derive a connector entity key from the filename or content
5. **Detect primary key candidates** — Identify columns with high uniqueness that could serve as primary keys

**Output:** `FileUploadRecommendation` schema (see Models section)

**Error**: `UPLOAD_AI_ANALYSIS_FAILED`, `UPLOAD_AI_TIMEOUT`

#### Phase 4 — Emit Recommendations

- Persist recommendations to job `result` field
- Transition job to `awaiting_confirmation` status
- Emit `job:recommendations` SSE event with full recommendation payload
- Job processor **returns** here — the confirm endpoint handles the rest

#### Phase 5–7 — Confirmation & Persistence (triggered by confirm endpoint)

Handled by `UploadsService.confirm()`, not the job processor. Runs in a **database transaction**:

1. **Create or update connector instance** — Upsert by `(connectorDefinitionId, organizationId, name)`
2. **Create or update connector entities** — Upsert by `(connectorInstanceId, key)`
3. **Create or update column definitions** — Upsert by `(organizationId, key)`
4. **Create or update field mappings** — Upsert by `(connectorEntityId, columnDefinitionId)`
5. **Transition job to `completed`** — Store created entity IDs in result

All upserts use idempotent logic: check existence by unique key, update if exists, create if not. This ensures re-submitting the same confirmation is safe.

---

## AI Agent Design (LangChain)

### Agent: `FileUploadAnalysisAgent`

**Framework**: LangChain.js with structured output

**Model**: Claude (via `@langchain/anthropic`)

**Architecture**: Single-pass chain with structured output, not a multi-step agent. The task is deterministic enough that a well-prompted chain with Zod-validated output is more reliable and faster than an autonomous agent loop.

```
┌──────────────────────┐
│  System Prompt        │  ← Schema analysis instructions, output format
│  + Existing Columns   │  ← Organization's current column_definitions
│  + CSV Analysis       │  ← Headers, sample rows, column statistics
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Claude LLM          │  ← withStructuredOutput(RecommendationSchema)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Zod-validated output │  ← FileUploadRecommendation
└──────────────────────┘
```

**Fallback Strategy**: If the AI call fails or times out (30s), fall back to a deterministic heuristic-based mapper:
- Infer types from sample values (regex patterns for dates, numbers, booleans)
- Match columns by exact key/label match only
- Flag all non-exact matches for manual review

**Why single-pass over LangGraph agent**: The CSV analysis task has a well-defined input/output contract. A multi-step agent adds latency and unpredictability without meaningful benefit. If future requirements add iterative refinement (e.g., "ask the user clarifying questions"), upgrade to a LangGraph `StateGraph` at that point.

---

## Models & Schemas

### New/Extended Schemas in `@portalai/core`

#### `FileUploadMetadataSchema` (extend existing in `job.model.ts`)

```typescript
export const FileUploadMetadataSchema = z.object({
  files: z.array(z.object({
    originalName: z.string(),
    s3Key: z.string(),
    sizeBytes: z.number(),
  })),
  organizationId: z.string(),
  connectorDefinitionId: z.string(),
});
```

#### `FileUploadResultSchema` (extend existing in `job.model.ts`)

```typescript
export const FileUploadResultSchema = z.object({
  // Phase 2 output
  parseResults: z.array(z.object({
    fileName: z.string(),
    delimiter: z.string(),
    hasHeader: z.boolean(),
    encoding: z.string(),
    rowCount: z.number(),
    headers: z.array(z.string()),
    sampleRows: z.array(z.record(z.unknown())),
    columnStats: z.array(z.object({
      header: z.string(),
      nullRate: z.number(),
      uniqueCount: z.number(),
      sampleValues: z.array(z.string()),
    })),
  })),
  // Phase 3-4 output
  recommendations: FileUploadRecommendationSchema.optional(),
  // Phase 7 output
  confirmedEntities: z.object({
    connectorInstanceId: z.string(),
    connectorEntityIds: z.array(z.string()),
    columnDefinitionIds: z.array(z.string()),
    fieldMappingIds: z.array(z.string()),
  }).optional(),
});
```

#### `FileUploadRecommendationSchema` (new)

```typescript
export const FileUploadRecommendationSchema = z.object({
  connectorInstance: z.object({
    name: z.string(),
    config: CSVParseOptionsSchema,
  }),
  entities: z.array(z.object({
    connectorEntity: z.object({
      key: z.string(),
      label: z.string(),
    }),
    columns: z.array(z.object({
      action: z.enum(["match_existing", "create_new"]),
      confidence: z.number().min(0).max(1),
      existingColumnDefinitionId: z.string().nullable(),
      recommended: ColumnDefinitionSchema.pick({
        key: true, label: true, type: true, required: true,
        format: true, enumValues: true, description: true,
      }),
      sourceField: z.string(),
      isPrimaryKeyCandidate: z.boolean(),
    })),
  })),
});
```

### New Job Status: `awaiting_confirmation`

Add to `JobStatusEnum` in `job.model.ts`:

```typescript
export const JOB_STATUSES = [
  "pending", "active", "completed", "failed",
  "stalled", "cancelled", "awaiting_confirmation",
] as const;
```

This is **not** a terminal status — the job can transition from `awaiting_confirmation` → `completed` or `awaiting_confirmation` → `cancelled`.

---

## New Files

### API (`apps/api/src/`)

| File | Purpose |
|------|---------|
| `routes/uploads.router.ts` | `POST /uploads/presign`, `POST /uploads/:jobId/process`, `POST /uploads/:jobId/confirm` |
| `services/uploads.service.ts` | Presigned URL generation, confirmation logic, transaction orchestration |
| `services/s3.service.ts` | S3 client wrapper: presign, head, stream, delete |
| `services/file-analysis.service.ts` | AI analysis via LangChain, heuristic fallback |
| `queues/processors/file-upload.processor.ts` | Job processor: verify → parse → analyze → recommend |

### Core (`packages/core/src/`)

| File | Purpose |
|------|---------|
| `contracts/upload.contract.ts` | Request/response Zod schemas for upload endpoints |

### Web (`apps/web/src/`)

| File | Purpose |
|------|---------|
| `components/FileUpload/FileUploadModal.component.tsx` | Upload modal with drag-and-drop |
| `components/FileUpload/RecommendationReview.component.tsx` | Review/edit AI recommendations |
| `hooks/useFileUpload.util.ts` | Upload mutation + SSE subscription hook |

---

## Idempotency Strategy

All persistence operations must be safe to retry:

| Entity | Unique Key | On Conflict |
|--------|-----------|-------------|
| `connector_instances` | `(connectorDefinitionId, organizationId, name)` | Update config, status |
| `connector_entities` | `(connectorInstanceId, key)` | Update label |
| `column_definitions` | `(organizationId, key)` | Update type, label, format, etc. |
| `field_mappings` | `(connectorEntityId, columnDefinitionId)` | Update sourceField, isPrimaryKey |

- The confirm endpoint is idempotent: re-submitting the same payload produces the same result
- Job status transitions are guarded: only valid transitions are allowed (e.g., `awaiting_confirmation` → `completed`, not `completed` → `active`)
- S3 storage uses `uploads/{orgId}/{jobId}/` as key prefix — re-uploading creates a new job with a new prefix, no collisions

---

## Error Handling & Edge Cases

### File-Level Errors

| Scenario | Handling |
|----------|----------|
| No files in presign request | 400 — `UPLOAD_NO_FILES` |
| Non-CSV file extension | 400 — `UPLOAD_INVALID_FILE_TYPE` |
| Declared file size exceeds limit (default 50MB) | 413 — `UPLOAD_FILE_TOO_LARGE` |
| Too many files (default >5) | 400 — `UPLOAD_TOO_MANY_FILES` |
| File not found in S3 when processing starts | Job fails — `UPLOAD_FILE_MISSING` |
| Actual S3 object size differs from declared | Job fails — `UPLOAD_FILE_SIZE_MISMATCH` |
| Empty CSV (0 data rows) | Job fails — `UPLOAD_EMPTY_FILE` |
| Malformed CSV (unclosed quotes, inconsistent columns) | Job fails — `UPLOAD_PARSE_FAILED`, includes row number and error detail |
| Encoding detection failure | Falls back to UTF-8, logs warning |
| S3 presign generation fails | 500 — `UPLOAD_S3_ERROR` |
| S3 stream read fails during parse | Job fails with retry — `UPLOAD_S3_READ_ERROR` |

### AI Analysis Errors

| Scenario | Handling |
|----------|----------|
| AI service unavailable | Falls back to heuristic mapper, flags all columns for manual review |
| AI response fails Zod validation | Retries once with stricter prompt, then falls back to heuristic |
| AI timeout (>30s) | Falls back to heuristic mapper |
| AI produces low-confidence matches (<0.5) | Marks as `create_new` with `confidence` score, user decides |

### Confirmation Errors

| Scenario | Handling |
|----------|----------|
| Job not in `awaiting_confirmation` state | 409 — `UPLOAD_INVALID_STATE` |
| Job belongs to different org | 403 — `JOB_UNAUTHORIZED` |
| Referenced column definition doesn't exist | 400 — `UPLOAD_INVALID_REFERENCE` |
| Duplicate key conflicts during upsert | Handled by idempotent upsert logic |
| Transaction failure | Full rollback, job stays in `awaiting_confirmation`, user can retry |
| Confirmation timeout | 504 — `UPLOAD_CONFIRM_TIMEOUT`, job stays retryable |

### SSE / Connectivity Errors

| Scenario | Handling |
|----------|----------|
| Client disconnects during processing | Job continues in background; client can reconnect and receive snapshot |
| SSE reconnect after disconnect | `job:snapshot` event replays current state including recommendations if already emitted |
| Job stalls (worker crash) | BullMQ auto-retries (up to 3 attempts with exponential backoff) |

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `UPLOAD_MAX_FILE_SIZE_MB` | `50` | Max file size per file |
| `UPLOAD_MAX_FILES` | `5` | Max files per upload |
| `UPLOAD_SAMPLE_ROWS` | `50` | Rows sent to AI for analysis |
| `UPLOAD_AI_TIMEOUT_MS` | `30000` | AI analysis timeout before fallback |
| `UPLOAD_ALLOWED_EXTENSIONS` | `.csv` | Allowed file extensions |
| `UPLOAD_AI_CONFIDENCE_THRESHOLD` | `0.8` | Auto-match threshold for column matching |
| `UPLOAD_S3_BUCKET` | — | S3 bucket name (required) |
| `UPLOAD_S3_REGION` | `us-east-1` | AWS region for the S3 bucket |
| `UPLOAD_S3_PREFIX` | `uploads` | Key prefix for uploaded files |
| `UPLOAD_S3_PRESIGN_EXPIRY_SEC` | `900` | Presigned URL expiry (15 minutes) |
| `UPLOAD_S3_RETENTION_DAYS` | `30` | Days before lifecycle rule deletes files |
| `AWS_ACCESS_KEY_ID` | — | AWS credentials (or use IAM role) |
| `AWS_SECRET_ACCESS_KEY` | — | AWS credentials (or use IAM role) |

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@aws-sdk/client-s3` | S3 operations (HeadObject, GetObject, DeleteObjects) |
| `@aws-sdk/s3-request-presigner` | Generate presigned PUT/GET URLs |
| `papaparse` or `csv-parse` | CSV parsing with streaming support |
| `@langchain/core` | LangChain framework |
| `@langchain/anthropic` | Claude LLM integration |
| `chardet` | Character encoding detection |

---

## Implementation Phases

Each phase is a full end-to-end slice — backend, frontend, and verification — that produces a working, testable workflow before moving on.

---

### Phase 1 — File Upload & Job Creation

User selects files, uploads them to S3, and receives a confirmed job ID.

#### Backend

- [x] Extend `job.model.ts`: add `awaiting_confirmation` to `JobStatusEnum`, flesh out `FileUploadMetadataSchema` with `files[]`, `organizationId`, `connectorDefinitionId`
- [x] Add upload-related error codes to `ApiCode` enum (`UPLOAD_NO_FILES`, `UPLOAD_INVALID_FILE_TYPE`, `UPLOAD_FILE_TOO_LARGE`, `UPLOAD_TOO_MANY_FILES`, `UPLOAD_S3_ERROR`)
- [x] Create `contracts/upload.contract.ts` with `PresignRequestBody`, `PresignResponsePayload`, `ProcessRequestParams`
- [x] Create `services/s3.service.ts` with `createPresignedUpload()` and `headObject()`
- [x] Create `routes/uploads.router.ts` with `POST /api/uploads/presign`:
  - Validate file count, extensions, declared sizes
  - Create a `pending` job with `FileUploadMetadata`
  - Generate presigned PUT URLs per file
  - Return `{ jobId, uploads[] }`
- [x] Create `POST /api/uploads/:jobId/process`:
  - Verify job exists, is `pending`, belongs to caller's org
  - `HeadObject` each S3 key to confirm uploads landed
  - Enqueue job in BullMQ
  - Return `202 { job }`
- [x] Register route in `app.ts`

#### Frontend

Build out the `CSVConnector.workflow` module (`apps/web/src/workflows/CSVConnector/`) — a modal-based, 4-step stepper workflow for uploading CSV files, reviewing AI-suggested entities and columns, and submitting the confirmed configuration.

##### Hooks & Utilities

- [x] Create `useFileUpload.util.ts` hook — Phase 1 scope: `presign()` mutation, S3 PUT upload with progress tracking (per-file `XMLHttpRequest` with `onprogress`), `process()` mutation
- [x] Create `useUploadWorkflow.util.ts` hook — orchestrates the full workflow state machine:
  - Tracks current step, selected files, `jobId`, SSE stream state, recommendations, user edits, and submission status
  - Exposes actions: `addFiles`, `removeFile`, `startUpload`, `updateEntity`, `updateColumn`, `confirm`, `cancel`
  - Manages step validation: Step 1 requires files selected + uploaded, Step 2 requires entities reviewed, Step 3 requires columns reviewed, Step 4 is read-only summary
  - Connects to SSE on `jobId` after `process()` call; parses `job:update`, `job:recommendations`, `job:error`, and `job:complete` events to advance the workflow automatically

##### Workflow Container

- [x] Create `CSVConnectorWorkflow.component.tsx` — container component:
  - Renders `<Modal>` wrapping a `<Stepper>` with 4 steps: **Upload CSV**, **Confirm Entities**, **Map Columns**, **Review & Import**
  - Consumes `useUploadWorkflow` hook and passes step-specific props down to each panel
  - Manages modal open/close state; resets workflow on close
  - Renders `<StepperNavigation>` with step-appropriate labels (e.g., "Upload" on Step 1, "Confirm" on Step 4)

##### Step 1 — Upload CSV (`UploadStep.component.tsx`)

- [x] Create `UploadStep.component.tsx`:
  - Renders `<FileUploader>` (from `@portalai/core`) configured for `.csv` files only
  - Displays selected file list with per-file size and remove button
  - On "Next": triggers presign → parallel S3 PUT uploads → process pipeline
  - Shows per-file upload progress bars during S3 upload
  - On success: stores `jobId`, auto-advances to Step 2 when SSE delivers recommendations
  - Shows "Processing..." state with overall progress bar while waiting for backend parsing + AI analysis

##### Step 2 — Confirm Entities (`EntityStep.component.tsx`)

- [x] Create `EntityStep.component.tsx`:
  - Receives AI-recommended entities from `job:recommendations` SSE event (one entity per uploaded file)
  - Renders editable list of entities — each with:
    - Entity key (editable text field, pre-filled from AI suggestion)
    - Entity label (editable text field, pre-filled from AI suggestion)
    - Source file name (read-only)
    - Row count and detected delimiter (read-only summary)
  - User can rename, reorder, or remove entities
  - Validation: at least one entity must remain before advancing

##### Step 3 — Map Columns (`ColumnMappingStep.component.tsx`)

- [x] Create `ColumnMappingStep.component.tsx`:
  - Tabbed layout — one tab per confirmed entity from Step 2
  - Per column row:
    - Source field (CSV header, read-only)
    - Recommended column key / label / type (editable)
    - Action toggle: `match_existing` (with searchable dropdown of existing org column definitions) or `create_new`
    - Confidence badge (percentage) for matched columns; low-confidence (<0.8) highlighted
    - Primary key toggle checkbox
  - Sample values preview (expandable, shows up to 5 sample values from parse results)
  - User can add, remove, or reorder column mappings
  - Validation: each entity must have at least one column mapped and exactly one primary key selected

##### Step 4 — Review & Import (`ReviewStep.component.tsx`)

- [x] Create `ReviewStep.component.tsx`:
  - Read-only summary of the full configuration before submission:
    - Connector instance name (editable, AI-suggested default)
    - Entity list with column counts
    - Per-entity column table: source field → target column key, type, action (match/create)
    - Total row counts across all entities
  - "Confirm" button triggers `POST /api/uploads/:jobId/confirm` with serialized user edits
  - Shows loading/progress state during confirmation persist
  - On success: displays completion summary (created/updated entities, column definitions, field mappings) with "Done" button to close modal
  - "Cancel" button calls `POST /api/jobs/:id/cancel`, shows cancellation confirmation, and closes modal

##### Wiring

- [x] Wire modal open to a "Connect" button (temporary placement in dashboard or connector list view)

#### Verification

- [x] Selecting a `.csv` file and clicking submit produces a `jobId` visible in the UI
- [x] Non-CSV files are rejected client-side before presign request
- [x] Files appear in S3 at `uploads/{orgId}/{jobId}/{filename}`
- [x] `POST /presign` returns 400 for invalid extensions, oversized files, or too many files
- [x] `POST /process` returns 400 if files are missing from S3
- [x] Job record exists in DB with status `pending` and correct metadata
- [x] Large file (50MB) uploads to S3 with progress feedback in the UI
- [x] Multiple files upload in parallel with independent progress bars

#### Tests

- [x] **Unit — Frontend** (`CSVConnectorWorkflow.test.tsx`): Modal shell renders, stepper displays 4 steps, file selection updates state, upload progress bars render per-file, navigation buttons enable/disable correctly per step
- [x] **Unit — Frontend** (`UploadStep.test.tsx`): FileUploader accepts only `.csv`, `addFiles` callback fires on selection, `removeFile` removes correct file, upload phase labels display correctly for each phase (`idle`, `presigning`, `uploading`, `processing`, `done`, `error`), progress bars reflect `uploadProgress` map values
- [x] **Unit — Frontend** (`useFileUpload.util.test.ts`): `presign()` calls correct endpoint with file metadata, S3 PUT uploads fire with correct presigned URLs, per-file progress callbacks update correctly, `process()` calls correct endpoint with `jobId`, error states propagate on presign/upload/process failure
- [x] **Unit — Frontend** (`useUploadWorkflow.test.ts`): `addFiles` / `removeFile` manage file list, `startUpload` delegates to `useFileUpload`, `goNext` / `goBack` / `goToStep` enforce step bounds (0-3), auto-advance on recommendations, `updateEntity` / `updateColumn` / `updateConnectorName` override AI values, `isProcessing` derived correctly, `reset` clears all state — 36 tests
- [x] **Unit — Backend** (`uploads.router.integration.test.ts`): `POST /presign` returns 400 for no files, invalid extensions, oversized files, too many files; returns 200 with `jobId` and presigned URLs for valid request. `POST /process` returns 400 if job not found, job not `pending`, or files missing from S3; returns 202 for valid request — covered by integration tests (262 tests)
- [x] **Unit — Backend** (`s3.service.test.ts`): `createPresignedUpload()` returns valid presigned URL structure, `headObject()` returns object metadata, both throw typed errors on S3 failure
- [x] **Integration — Backend** (`uploads.router.integration.test.ts`): Full presign → S3 upload → process flow creates job in DB with `pending` status, correct metadata, and enqueues BullMQ job. Verify S3 keys match expected pattern `uploads/{orgId}/{jobId}/{filename}`
- [x] All Phase 1 tests pass (`npm run test -- -- --testPathPattern="(uploads|UploadStep|useFileUpload|useUploadWorkflow|CSVConnector)"`) ✅

---

### Phase 2 — CSV Parsing & SSE Progress

Job processor streams CSV from S3, parses it, and the frontend shows real-time progress via SSE.

#### Backend

- [x] Create `queues/processors/file-upload.processor.ts` — Phase 2 scope: S3 verification + CSV parsing only
- [x] Register `file_upload` processor in `processors/index.ts`
- [x] Implement Phase 1 (S3 verification): `headObject()` per file, validate sizes, check non-empty
- [x] Implement Phase 2 (CSV parsing): single-pass streaming parser per file
  - Auto-detect delimiter from first 4KB
  - Detect encoding via `chardet` on first 4KB
  - Capture first 50 sample rows
  - Running accumulators: row count, null rate, unique count (capped at 1,000), min/max length, 10 sample values per column
  - Byte-based progress: `progress = 10 + (fileIdx / fileCount) * 20`
- [x] Extend `FileUploadResultSchema` with `parseResults[]` (per-file: fileName, delimiter, hasHeader, encoding, rowCount, headers, sampleRows, columnStats)
- [x] Persist `parseResults` to job `result` field after all files parsed
- [x] Add error codes: `UPLOAD_FILE_MISSING`, `UPLOAD_FILE_SIZE_MISMATCH`, `UPLOAD_EMPTY_FILE`, `UPLOAD_PARSE_FAILED`, `UPLOAD_ENCODING_ERROR`, `UPLOAD_S3_READ_ERROR`
- [x] After parsing completes, temporarily transition job to `completed` (Phase 3 will change this to `awaiting_confirmation`)

#### Frontend

- [x] Extend `upload-workflow.util.ts` — wire SSE subscription via existing `/sse/jobs/:id/events` endpoint into workflow state machine after `process()` call
- [x] Update `UploadStep.component.tsx` "Processing..." state:
  - Display overall progress bar driven by `job:update` events
  - Display current phase label ("Verifying files...", "Parsing contacts.csv...")
  - Handle `job:error` events — show error message with detail, allow dismiss
  - Handle SSE disconnect — auto-reconnect, show "Reconnecting..." indicator
- [x] On `job:complete` (temporary for Phase 2), show parse summary in `UploadStep`: files parsed, row counts, detected delimiters

#### Verification

- [ ] Uploading a CSV triggers SSE progress events that update the UI progress bar in real time
- [ ] Progress moves smoothly from 10→30 during parse phase (byte-based, not jumpy)
- [ ] Parse results include correct delimiter, header detection, row count, and sample rows
- [ ] A 50MB CSV parses without OOM (worker memory stays under 50MB)
- [ ] Multi-file upload shows sequential per-file progress
- [ ] Column stats show capped unique counts (marked `"capped"`) for high-cardinality columns
- [ ] Malformed CSV (unclosed quotes) produces `UPLOAD_PARSE_FAILED` with row/line detail visible in UI
- [ ] Empty CSV produces `UPLOAD_EMPTY_FILE` error visible in UI
- [ ] SSE reconnect after network drop replays current state via `job:snapshot`
- [ ] Job failure (e.g., S3 read error) triggers BullMQ retry (up to 3 attempts)

#### Tests

- [ ] **Unit — Backend** (`file-upload.processor.test.ts`): S3 verification phase calls `headObject()` per file and fails on missing/empty files. CSV parser detects correct delimiter from first 4KB. Encoding detection returns correct charset. Sample rows capped at 50. Column stats accumulate correctly (null rate, unique count capped at 1,000, min/max length). Progress events emitted at correct byte-based intervals. Parse results match `FileUploadResultSchema` shape
- [ ] **Unit — Backend** (`file-upload.processor.test.ts` — error paths): Malformed CSV (unclosed quotes) throws `UPLOAD_PARSE_FAILED` with row/line detail. Empty CSV throws `UPLOAD_EMPTY_FILE`. S3 read error throws `UPLOAD_S3_READ_ERROR`. Encoding detection failure throws `UPLOAD_ENCODING_ERROR`
- [ ] **Unit — Frontend** (`UploadStep.test.tsx` — SSE states): Progress bar updates on `job:update` events, phase label shows "Verifying files..." then "Parsing {filename}...", error message renders on `job:error`, "Reconnecting..." indicator shows on SSE disconnect
- [ ] **Unit — Frontend** (`useUploadWorkflow.util.test.ts` — SSE): SSE subscription starts after `process()`, `job:update` events update `jobProgress`, `job:error` events set `jobError`, SSE disconnect sets `connectionStatus` to reconnecting
- [ ] **Integration — Backend** (`file-upload.processor.integration.test.ts`): Full processor run with real CSV in S3 — parses file, emits progress events, persists `parseResults` to job `result` field, transitions job to `completed`. Multi-file sequential processing produces correct per-file results. 50MB CSV processes within memory limits
- [ ] All Phase 2 tests pass (`npm run test -- --testPathPattern="(file-upload.processor|UploadStep|useUploadWorkflow)"`) ✅

---

### Phase 3 — AI Analysis & Recommendations

AI analyzes parsed results, generates schema recommendations, and the frontend displays them for review.

#### Backend

- [ ] Create `services/file-analysis.service.ts`:
  - `analyzeFile()` — LangChain single-pass chain with `withStructuredOutput(FileUploadRecommendationEntitySchema)`
  - Input: file parse result + existing org column definitions + cumulative recommendations from prior files
  - Output: entity recommendation (connector entity key/label, column matches/creates, field mappings, primary key candidates)
  - Confidence scores per column match (0-1)
- [ ] Implement heuristic fallback in `file-analysis.service.ts`:
  - Regex-based type inference (dates, numbers, booleans, emails)
  - Exact key/label match against existing column definitions
  - All non-exact matches flagged `action: "create_new"` with `confidence: 0`
  - Activated on AI timeout (30s), AI error, or Zod validation failure (after 1 retry)
- [ ] Create `FileUploadRecommendationSchema` in `job.model.ts`
- [ ] Extend job processor Phase 3: invoke `analyzeFile()` per file sequentially with cumulative context
  - Progress: `30 + (fileIdx / fileCount) * 40` (maps to 30-70 range)
- [ ] Extend job processor Phase 4: persist recommendations to job `result.recommendations`, transition to `awaiting_confirmation`
- [ ] Add `job:recommendations` SSE event type — emitted once with full recommendation payload
- [ ] Add error codes: `UPLOAD_AI_ANALYSIS_FAILED`, `UPLOAD_AI_TIMEOUT`

#### Frontend

- [ ] Extend `useUploadWorkflow.util.ts` — on `job:recommendations` SSE event, parse recommendation payload and auto-advance stepper from Step 1 ("Processing...") to Step 2 ("Confirm Entities")
- [ ] Populate `EntityStep.component.tsx` with AI-recommended entities from recommendation payload
- [ ] Populate `ColumnMappingStep.component.tsx` with AI-recommended column mappings, confidence scores, and sample values from recommendation payload
- [ ] Populate `ReviewStep.component.tsx` connector instance name with AI-suggested default
- [ ] Show parse summary (row counts, delimiters) as read-only context in `EntityStep` above entity list

#### Verification

- [ ] AI recommendations appear in the UI after parsing completes
- [ ] Each file produces a separate entity tab/section with its own column mappings
- [ ] Existing column definitions are matched with confidence scores displayed
- [ ] Low-confidence matches (<0.8) are visually highlighted
- [ ] User can change a column from "match existing" to "create new" and vice versa
- [ ] User can edit recommended key, label, type, and format for any column
- [ ] User can edit entity key and label
- [ ] User can edit connector instance name
- [ ] Multi-file upload: columns shared across files (e.g., `email`) show as `match_existing` in the second file referencing the first file's recommendation
- [ ] AI timeout or failure falls back to heuristic mapper — columns appear with `confidence: 0` and all flagged for review
- [ ] Heuristic correctly infers `date`, `number`, `boolean` types from sample values
- [ ] Progress bar moves smoothly from 30→70 during analysis phase, then 70→80 during recommendation assembly

#### Tests

- [ ] **Unit — Backend** (`file-analysis.service.test.ts`): `analyzeFile()` returns valid `FileUploadRecommendationEntitySchema` output. Confidence scores are between 0-1. Existing column definitions produce `match_existing` actions. Unknown columns produce `create_new` actions. Cumulative context from prior files influences subsequent recommendations (shared columns matched). AI timeout (30s) triggers heuristic fallback. AI Zod validation failure retries once then falls back to heuristic
- [ ] **Unit — Backend** (`file-analysis.service.test.ts` — heuristic fallback): Regex type inference detects dates, numbers, booleans, emails from sample values. Exact key/label match against existing column definitions works. Non-exact matches flagged `create_new` with `confidence: 0`. All columns returned with valid schema shape
- [ ] **Unit — Backend** (`file-upload.processor.test.ts` — Phase 3): AI analysis invoked per file sequentially. Progress events emitted at 30-70 range. Recommendations persisted to job `result.recommendations`. Job transitions to `awaiting_confirmation`. `job:recommendations` SSE event emitted with full payload
- [ ] **Unit — Frontend** (`EntityStep.test.tsx`): Entity list renders from recommendations. Entity key and label fields are editable. Source file name displays as read-only. `updateEntity` callback fires with correct index and updates. Validation prevents advancing with zero entities
- [ ] **Unit — Frontend** (`ColumnMappingStep.test.tsx`): Tabbed layout renders one tab per entity. Column rows display source field, recommended key/label/type. Confidence badge renders with correct color (success ≥0.8, warning ≥0.5, error <0.5). Action toggle switches between `match_existing` and `create_new`. Primary key toggle updates correctly. `updateColumn` callback fires with correct entity and column indices
- [ ] **Unit — Frontend** (`useUploadWorkflow.util.test.ts` — recommendations): `job:recommendations` event populates `recommendations` state, auto-advances to step 1, `updateEntity` / `updateColumn` override AI values, edited values persist across step navigation
- [ ] **Integration — Backend** (`file-analysis.integration.test.ts`): Full analysis pipeline with real parse results — AI service returns valid recommendations, heuristic fallback produces valid output when AI is unavailable, multi-file analysis builds cumulative context correctly
- [ ] All Phase 3 tests pass (`npm run test -- --testPathPattern="(file-analysis|file-upload.processor|EntityStep|ColumnMappingStep|useUploadWorkflow)"`) ✅

---

### Phase 4 — Confirmation & Persistence

User confirms (or modifies) recommendations, backend persists all entities in a transaction, job completes.

#### Backend

- [ ] Create `contracts/upload.contract.ts` additions: `ConfirmRequestBody`, `ConfirmResponsePayload`
- [ ] Implement `POST /api/uploads/:jobId/confirm` in `uploads.router.ts`:
  - Validate job is in `awaiting_confirmation` state
  - Validate job belongs to caller's org
  - Validate request body against `ConfirmRequestBody` schema
- [ ] Implement `UploadsService.confirm()`:
  - Run in a single database transaction
  - Upsert connector instance by `(connectorDefinitionId, organizationId, name)`
  - For each entity: upsert connector entity by `(connectorInstanceId, key)`
  - For each column: upsert column definition by `(organizationId, key)`
  - For each mapping: upsert field mapping by `(connectorEntityId, columnDefinitionId)`
  - Store created/updated entity IDs in job `result.confirmedEntities`
  - Transition job to `completed`
- [ ] Emit `job:complete` SSE event with confirmed entity IDs
- [ ] Add error codes: `UPLOAD_INVALID_STATE`, `UPLOAD_INVALID_REFERENCE`, `UPLOAD_CONFIRM_TIMEOUT`
- [ ] Idempotency: re-submitting identical confirmation payload returns same result without duplicating records

#### Frontend

- [ ] Wire "Confirm" button in `ReviewStep.component.tsx`:
  - Serialize edited entities and column mappings from Steps 2-3 into `ConfirmRequestBody`
  - Show loading state on button during request
  - On success: transition `ReviewStep` to completion summary view
- [ ] Completion summary view (within `ReviewStep`):
  - Connector instance name and status
  - List of created/updated entities with row counts
  - List of created/updated column definitions
  - "Done" button closes workflow modal
- [ ] Wire "Cancel" button in `CSVConnectorWorkflow.component.tsx`:
  - Available at any step via modal header or stepper navigation
  - Calls existing `POST /api/jobs/:id/cancel` endpoint (if `jobId` exists)
  - Triggers S3 cleanup (files deleted via `S3Service.deletePrefix()`)
  - Shows cancelled confirmation, closes modal

#### Verification

- [ ] Clicking "Confirm" creates all expected records in the database (connector instance, entities, column definitions, field mappings)
- [ ] Records match the user's edits, not just the original AI recommendations
- [ ] Completion summary displays correct counts of created vs updated records
- [ ] Re-clicking "Confirm" (idempotent) returns the same result without duplicating records
- [ ] Column definitions shared across entities are created once, not duplicated
- [ ] Job transitions from `awaiting_confirmation` → `completed` and SSE emits `job:complete`
- [ ] Cancelling the job transitions to `cancelled`, deletes S3 files, and closes the modal
- [ ] Confirming a job that is not in `awaiting_confirmation` returns 409
- [ ] Transaction rollback on partial failure: no orphaned records, job stays in `awaiting_confirmation`
- [ ] Referenced existing column definitions are validated — invalid IDs return 400

#### Tests

- [ ] **Unit — Backend** (`uploads.router.test.ts` — confirm): `POST /confirm` returns 409 if job not in `awaiting_confirmation`. Returns 400 for invalid request body. Returns 400 for invalid column definition references. Returns 200 with confirmed entity summary on success
- [ ] **Unit — Backend** (`uploads.service.test.ts`): `confirm()` upserts connector instance, entities, column definitions, and field mappings. Shared column definitions across entities created once (not duplicated). Idempotent — re-calling with same payload returns same result. Job transitions to `completed`. `job:complete` SSE event emitted with confirmed entity IDs
- [ ] **Unit — Backend** (`uploads.service.test.ts` — error paths): Transaction rolls back on DB error — no orphaned records, job stays `awaiting_confirmation`. Invalid column definition IDs throw `UPLOAD_INVALID_REFERENCE`. Confirm timeout throws `UPLOAD_CONFIRM_TIMEOUT`
- [ ] **Unit — Frontend** (`ReviewStep.test.tsx`): Summary displays connector name, entity list with column counts, per-entity column table. "Confirm" button triggers confirm callback. Loading state disables confirm button. Completion summary renders created/updated counts. "Done" button triggers close. "Cancel" button triggers cancel callback
- [ ] **Unit — Frontend** (`useUploadWorkflow.util.test.ts` — confirm): `confirm()` serializes edited entities and columns into correct request body. Success updates workflow to completion state. Failure sets error state. `cancel()` calls cancel endpoint when `jobId` exists
- [ ] **Integration — Backend** (`uploads.confirm.integration.test.ts`): Full confirm flow — creates connector instance, entities, column definitions, field mappings in DB. Verify records match submitted edits. Re-submit same payload — no duplicate records created. Cancel flow — job transitions to `cancelled`, S3 files deleted. Verify transaction atomicity — simulate DB failure mid-confirm, verify no partial records
- [ ] All Phase 4 tests pass (`npm run test -- --testPathPattern="(uploads|ReviewStep|useUploadWorkflow)"`) ✅

---

### Phase 5 — Error Handling, Edge Cases & Polish

Harden all paths, handle connectivity issues, and ensure graceful degradation.

#### Backend

- [ ] S3 cleanup on job cancellation: `S3Service.deletePrefix()` removes all objects under `uploads/{orgId}/{jobId}/`
- [ ] S3 cleanup on job failure (all retries exhausted): retain files for debugging, rely on lifecycle rule
- [ ] Configure S3 lifecycle rule documentation for `uploads/` prefix (30-day expiry)
- [ ] Add `S3Service.deletePrefix()` and `S3Service.getObjectStream()` (if not already implemented in Phase 2)
- [ ] Presigned URL expiry handling: if `POST /process` is called after presigned URLs expire but files were uploaded, proceed normally (presign expiry only affects upload, not processing)
- [ ] Guard all job status transitions: only allow valid paths (`pending` → `active`, `active` → `awaiting_confirmation`, `awaiting_confirmation` → `completed`/`cancelled`, `active` → `failed`)
- [ ] BullMQ retry behavior: verify exponential backoff works for transient S3/AI failures (3 attempts, 2s base delay)
- [ ] Swagger documentation for all three upload endpoints

#### Frontend

- [ ] File validation UX: client-side rejection of non-CSV files with inline error (before presign request)
- [ ] File size validation UX: client-side rejection of oversized files with inline error
- [ ] S3 upload failure handling: retry individual file upload up to 3 times, show per-file error if all retries fail
- [ ] SSE disconnect indicator: "Reconnecting..." banner with auto-reconnect
- [ ] SSE reconnect: re-fetch job state via `job:snapshot` to recover after disconnect
- [ ] Error states for each phase: presign failure, S3 upload failure, processing failure, AI failure, confirm failure — each with user-friendly message and retry/dismiss actions
- [ ] Loading and disabled states: prevent double-submit on presign, process, and confirm
- [ ] Modal close guard: warn user if processing is in progress ("Job will continue in background")
- [ ] Accessibility: keyboard navigation, screen reader labels for drag-and-drop zone, progress bars, and action buttons

#### Verification

- [ ] Non-CSV file rejected in browser with error message (no network request made)
- [ ] Oversized file rejected in browser with error message
- [ ] S3 upload failure for one file shows retry option, other files unaffected
- [ ] Network disconnect during SSE recovers gracefully — progress bar picks up where it left off
- [ ] Closing modal during processing shows warning, job continues in background
- [ ] Re-opening upload flow after background job completes shows completion state (not a blank modal)
- [ ] All API errors surface user-friendly messages (not raw error codes)
- [ ] Double-clicking confirm does not create duplicate records
- [ ] Job cancellation during active processing stops the worker and cleans up S3
- [ ] S3 files are deleted after cancellation, retained after failure
- [ ] All three upload endpoints appear in Swagger docs with correct request/response schemas

#### Tests

- [ ] **Unit — Backend** (`s3.service.test.ts` — cleanup): `deletePrefix()` removes all objects under given prefix. Cancellation triggers `deletePrefix()` for job's S3 path. Failure retains files (no cleanup called)
- [ ] **Unit — Backend** (`uploads.router.test.ts` — edge cases): Presigned URL expiry does not block `POST /process` if files already uploaded. Invalid job status transitions return appropriate error codes. BullMQ retry configuration verified (3 attempts, exponential backoff)
- [ ] **Unit — Frontend** (`UploadStep.test.tsx` — validation): Non-CSV file rejected with inline error (no presign call). Oversized file rejected with inline error. Both errors clearable by user
- [ ] **Unit — Frontend** (`UploadStep.test.tsx` — error recovery): S3 upload failure shows per-file retry option. SSE disconnect shows "Reconnecting..." banner. SSE reconnect re-renders current progress state
- [ ] **Unit — Frontend** (`CSVConnectorWorkflow.test.tsx` — guards): Modal close during processing shows warning dialog. Double-click on confirm disabled by loading state. Cancel button available at every step when `jobId` exists
- [ ] **Unit — Frontend** (`CSVConnectorWorkflow.test.tsx` — accessibility): Keyboard navigation through stepper steps. Screen reader labels on file drop zone, progress bars, and action buttons. Focus management on modal open/close
- [ ] **Integration — Backend** (`uploads.edge-cases.integration.test.ts`): Job cancellation during active processing — worker stops, S3 files deleted, job status `cancelled`. Job failure after max retries — files retained, job status `failed`. Concurrent confirm requests — only one succeeds, no duplicate records. Full end-to-end: presign → upload → process → parse → analyze → confirm → verify all DB records
- [ ] **Integration — Frontend** (`CSVConnectorWorkflow.integration.test.tsx`): Full workflow render with mocked API — file select → upload → SSE progress → recommendations → entity edits → column edits → review → confirm. Verify each step transition, data persistence across steps, and final confirm payload structure
- [ ] All Phase 5 tests pass (`npm run test -- --testPathPattern="(uploads|s3.service|CSVConnector|UploadStep)"`) ✅
- [ ] **Full suite**: All file upload tests pass (`npm run test`) with ≥60% coverage across branches, functions, lines, and statements ✅
