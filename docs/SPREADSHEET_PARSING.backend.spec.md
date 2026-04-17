# Spreadsheet Parsing — Backend Spec

Implementation spec for the core spreadsheet-parsing module, its integration with `FileUploadConnector`, and the persistence/sync changes needed for multi-region, multi-entity plans.

Read `SPREADSHEET_PARSING.architecture.spec.md` first for the conceptual model, module boundary, usage modes, confidence framework, and region → entity merge rules. This spec provides concrete types, algorithms, and schema changes.

## Module layout

New package under `packages/`:

```
packages/spreadsheet-parsing/
  src/
    workbook/               # Workbook type + helpers (row, col, range accessors)
    plan/                   # LayoutPlan Zod schemas + version semantics
    interpret/
      index.ts              # interpret() entry point
      state.ts              # shared InterpretState object
      stages/
        detect-regions.ts
        detect-headers.ts
        detect-identity.ts
        classify-columns.ts
        propose-bindings.ts
        reconcile-with-prior.ts
        recommend-records-axis-name.ts
        score-and-warn.ts
    replay/
      index.ts              # replay() entry point
      drift.ts              # drift detection rules
    warnings/               # Warning code enum + message templates
    __tests__/
      fixtures/             # Irregular spreadsheet fixtures + expected plans
  package.json
```

Exported publicly:

- `Workbook`, `WorkbookCell`, `WorkbookRange` types
- `LayoutPlan`, `InterpretInput`, `InterpretResult`, `ReplayResult`, `DriftReport` types
- `interpret(input: InterpretInput): Promise<LayoutPlan>`
- `replay(plan: LayoutPlan, workbook: Workbook): ReplayResult`
- Warning code enum

Not exported: stage functions, LLM client, prompt templates (internal).

## Core types

All types are defined as Zod schemas in `packages/spreadsheet-parsing/src/plan/*.ts`, then re-exported from `@portalai/core/contracts` so API and web can validate them. The backend enforces these at route boundaries; the frontend validates user-edited plans before submitting.

### `Workbook`

Provider-agnostic view. No bytes, no API clients, no auth.

```ts
interface Workbook {
  sheets: Sheet[];
}

interface Sheet {
  name: string;                      // provider-supplied sheet name
  dimensions: { rows: number; cols: number }; // used-range dimensions
  cell(row: number, col: number): WorkbookCell | undefined; // 1-based
  range(startRow: number, startCol: number, endRow: number, endCol: number): WorkbookCell[][];
}

interface WorkbookCell {
  row: number;                       // 1-based
  col: number;                       // 1-based
  value: string | number | boolean | Date | null;
  rawText?: string;                  // original display text if distinct from value
  merged?: { startRow: number; startCol: number; endRow: number; endCol: number };
}
```

Adapter implementations live in consumers, not in the module:

- `FileUploadConnector`: CSV via `papaparse`, XLSX via `exceljs` or `xlsx`.
- Future Google Sheets connector: Sheets API v4 values response.
- Future Microsoft connector: Graph Excel REST workbook response.

### `LayoutPlan` (v1)

```ts
const LayoutPlanSchema = z.object({
  planVersion: z.string(),           // semver; v1 = "1.0.0"
  workbookFingerprint: z.object({
    sheetNames: z.array(z.string()),
    dimensions: z.record(z.string(), z.object({ rows: z.number(), cols: z.number() })),
    anchorCells: z.array(z.object({ sheet: z.string(), row: z.number(), col: z.number(), value: z.string() })),
  }),
  regions: z.array(RegionSchema),
  confidence: z.object({
    overall: z.number().min(0).max(1),
    perRegion: z.record(z.string(), z.number().min(0).max(1)),
  }),
});

const RegionSchema = z.object({
  id: z.string().uuid(),
  sheet: z.string(),
  bounds: z.object({
    startRow: z.number().int().min(1),
    endRow: z.union([z.number().int().min(1), z.literal("dynamic")]),
    startCol: z.number().int().min(1),
    endCol: z.number().int().min(1),
  }),
  targetEntityDefinitionId: z.string(),
  orientation: z.enum(["rows-as-records", "columns-as-records"]),
  headerAxis: z.enum(["row", "column"]),
  recordsAxisName: z.object({
    name: z.string(),
    source: z.enum(["user", "ai"]),
    confidence: z.number().min(0).max(1),
  }).optional(),
  headerStrategy: HeaderStrategySchema,
  identityStrategy: IdentityStrategySchema,
  columnBindings: z.array(ColumnBindingSchema),
  skipRules: z.array(SkipRuleSchema),
  drift: DriftKnobsSchema,
  confidence: z.object({
    region: z.number().min(0).max(1),
    aggregate: z.number().min(0).max(1),
  }),
  warnings: z.array(WarningSchema),
});
```

Discriminated-union schemas (concrete variants limited to v1 keeps):

```ts
const LocatorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cell"), sheet: z.string(), row: z.number(), col: z.number() }),
  z.object({ kind: z.literal("range"), sheet: z.string(), startRow: z.number(), startCol: z.number(), endRow: z.number(), endCol: z.number() }),
  z.object({ kind: z.literal("column"), sheet: z.string(), col: z.number() }),
  z.object({ kind: z.literal("row"), sheet: z.string(), row: z.number() }),
]);

const HeaderStrategySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("row"), locator: LocatorSchema, confidence: z.number() }),
  z.object({ kind: z.literal("column"), locator: LocatorSchema, confidence: z.number() }),
  z.object({ kind: z.literal("rowLabels"), locator: LocatorSchema, confidence: z.number() }),
]);

const IdentityStrategySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("column"), sourceLocator: LocatorSchema, confidence: z.number() }),
  z.object({ kind: z.literal("composite"), sourceLocators: z.array(LocatorSchema), joiner: z.string(), confidence: z.number() }),
  z.object({ kind: z.literal("rowPosition"), confidence: z.number() }), // always emits warn severity
]);

const BindingSourceLocatorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("byHeaderName"), name: z.string() }),
  z.object({ kind: z.literal("byColumnIndex"), col: z.number() }), // fallback only
]);

const SkipRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("blank") }),
  z.object({ kind: z.literal("columnMatches"), colLocator: LocatorSchema, regex: z.string() }),
]);

const DriftKnobsSchema = z.object({
  headerShiftRows: z.number().int().min(0).default(0),
  addedColumns: z.enum(["halt", "auto-apply"]).default("halt"),
  removedColumns: z.object({ max: z.number().int().min(0), action: z.enum(["halt", "auto-apply"]).default("halt") }),
});

const WarningSchema = z.object({
  code: WarningCodeEnum,
  severity: z.enum(["info", "warn", "blocker"]),
  locator: LocatorSchema.optional(),
  message: z.string(),
  suggestedFix: z.string().optional(),
});
```

### `InterpretInput`

```ts
interface InterpretInput {
  workbook: Workbook;
  regionHints?: RegionHint[];        // primary path — user-drawn regions
  priorPlan?: LayoutPlan;            // Mode B only
  driftReport?: DriftReport;         // Mode B only
  userHints?: UserHints;             // freeform notes, column nicknames, etc.
}

interface RegionHint {
  sheet: string;
  bounds: { startRow: number; startCol: number; endRow: number; endCol: number }; // 1-based, inclusive
  targetEntityDefinitionId: string;
  orientation: "rows-as-records" | "columns-as-records";
  headerAxis: "row" | "column";
  recordsAxisName?: string;          // required for pivoted regions (headerAxis differs from records direction)
  proposedLabel?: string;            // user-facing name for this region
}
```

Semantics:

- When `regionHints` is supplied, the interpreter **skips `detectRegions`** and creates exactly one region per hint.
- Everything downstream (header detection within bounds, identity, classification, confidence, warnings) still runs per region.
- When `regionHints` is omitted, the interpreter runs auto-detection on the workbook as a best-effort fallback.

### `ReplayResult` and `DriftReport`

```ts
interface ReplayResult {
  records: ExtractedRecord[];
  drift: DriftReport;
}

interface ExtractedRecord {
  regionId: string;
  targetEntityDefinitionId: string;
  sourceId: string;
  checksum: string;
  fields: Record<string, unknown>;   // keyed by ColumnDefinition id
}

interface DriftReport {
  regionDrifts: RegionDrift[];
  severity: "none" | "info" | "warn" | "blocker";
  identityChanging: boolean;         // true if any drift would alter source_id derivation
}

interface RegionDrift {
  regionId: string;
  kinds: DriftKind[];                // e.g., "header-shifted", "added-columns", "removed-columns", "bounds-overflow", "records-axis-value-renamed"
  details: unknown;                  // per-kind payload
  withinTolerance: boolean;          // evaluated against the region's own drift knobs
}
```

## `interpret()` — stage decomposition

Single typed entry point:

```ts
export async function interpret(input: InterpretInput): Promise<LayoutPlan>;
```

Interior is organized around a shared `InterpretState` object, even when all stages execute in one LLM call. The state type is exported for testing but not for external use.

```ts
interface InterpretState {
  input: InterpretInput;
  detectedRegions: Region[];         // populated by detectRegions, or seeded from regionHints
  headerCandidates: Map<string, HeaderCandidate[]>; // regionId → candidates
  identityCandidates: Map<string, IdentityCandidate[]>;
  columnClassifications: Map<string, ColumnClassification[]>;
  recordsAxisNameSuggestions: Map<string, { name: string; confidence: number }>;
  reconcileDiff?: ReconcileDiff;     // Mode B only
  confidence: Map<string, RegionConfidence>;
  warnings: Warning[];
}
```

Stage contracts (all pure, all fixture-testable):

| Stage | Input | Output on state |
|---|---|---|
| `detectRegions` | workbook (skipped if hints present) | `detectedRegions` |
| `detectHeaders` | region bounds + sheet slice | `headerCandidates` |
| `detectIdentity` | region + header candidates | `identityCandidates` |
| `classifyColumns` | region + header + `ColumnDefinition`s | `columnClassifications` |
| `recommendRecordsAxisName` | pivoted region + axis labels | `recordsAxisNameSuggestions` (gated on pivoted and no user-supplied name) |
| `proposeBindings` | all above | assembled `Region[]` with bindings |
| `reconcileWithPrior` | assembled regions + `priorPlan` | `reconcileDiff`, region id stability |
| `scoreAndWarn` | full state | `confidence`, `warnings` |

v1 implementation: one structured-output LLM call whose schema exactly matches the state shape. Stage functions prep their inputs and interpret their slice of the output, so the outer call is the only model interaction. Each stage remains individually unit-testable with a mocked state slice.

### `recommendRecordsAxisName` sub-call

Narrow prompt: input is the axis labels (≤ ~30 strings), output is `{ name: string; confidence: number }`. Invoked only for pivoted regions (`headerAxis` does not match records direction) where the user has not supplied `recordsAxisName`. Keeps the AI cost for axis naming bounded and independent of the main interpret budget.

## `replay()` algorithm

```ts
export function replay(plan: LayoutPlan, workbook: Workbook): ReplayResult;
```

No LLM call. Pure function of `(plan, workbook)`.

For each region:

1. Resolve `bounds` against the workbook (literal range, or `dynamic` end-row expands until terminator per skip rules).
2. Resolve `headerStrategy` → map from header-axis labels to `ColumnDefinition` ids via `columnBindings`.
3. Walk records along the records axis (rows for `rows-as-records`, columns for `columns-as-records`).
4. Apply `skipRules` to exclude non-data rows.
5. For each record, compute `source_id` via `identityStrategy`.
6. For pivoted regions, attach `{ [recordsAxisName.name]: axisLabel }` to every record.
7. Compute `checksum` over the record's field values (stable, order-independent).
8. Emit `ExtractedRecord`.

While walking, collect drift signals:

- **Bounds overflow**: rectangular data exists beyond the region's `bounds` (more non-blank rows/cols than expected).
- **Header shift**: header cells moved within `headerShiftRows` tolerance.
- **Added columns**: new header labels not present in `columnBindings`.
- **Removed columns**: bindings whose resolved source column is absent.
- **Records-axis value renamed**: pivoted region's axis label set differs from stored fingerprint.
- **Identity column has blanks** / **duplicate identity values**: detected during `source_id` computation.

Each drift kind is checked against the region's `drift` knobs:

- `addedColumns: "auto-apply"` means added columns are silently ignored (their source data is dropped, warning is logged as `info`).
- `addedColumns: "halt"` (default) means `identityChanging: false` but `severity: "warn"` or higher.
- `removedColumns.max` caps how many bindings may drop before `severity: "blocker"` escalates.
- Any drift classified as `records-axis-value-renamed` **always** sets `identityChanging: true` regardless of knobs.

Consumers use `DriftReport.severity` and `identityChanging` to decide whether to commit, halt, or call `interpret()` again.

## Warning codes

Enum `WarningCode` in `packages/spreadsheet-parsing/src/warnings/codes.ts`:

- `AMBIGUOUS_HEADER`
- `MULTIPLE_HEADER_CANDIDATES`
- `MIXED_COLUMN_TYPES`
- `DUPLICATE_IDENTITY_VALUES`
- `IDENTITY_COLUMN_HAS_BLANKS`
- `UNRECOGNIZED_COLUMN`
- `REGION_BOUNDS_UNCERTAIN`
- `BOUNDS_OVERFLOW`
- `SHEET_MAY_BE_NON_DATA`
- `PIVOTED_REGION_MISSING_AXIS_NAME` (blocker by default)
- `ROW_POSITION_IDENTITY` (warn by default — id = "row-{n}" breaks on reorder)
- `UNSUPPORTED_LAYOUT_SHAPE` (blocker; used when the interpreter encounters a deferred-variant shape)
- `RECORDS_AXIS_VALUE_RENAMED` (drift only)

Severity defaults are module-level; consumers may override via a `WarningPolicy` passed to UI layers (not to the parser itself).

## Schema changes

### `ConnectorEntity` — 1:1 with `targetEntityDefinitionId`

No structural change to `connector_entities` table is required; the change is in how rows are created:

- Today: `FileUploadConnector` creates one `ConnectorEntity` per uploaded sheet.
- With plans: `FileUploadConnector` creates one `ConnectorEntity` per **distinct `targetEntityDefinitionId`** in the plan. Regions with the same target merge into the same `ConnectorEntity`.

Backfill: existing uploads continue to work unchanged (they have no plan; they use the legacy simple-path).

### `FieldMapping` — belongs to merged entity

No schema change. `FieldMapping` rows are already keyed to `ConnectorEntity`. Under the merged model, one `ConnectorEntity` spans multiple regions; its `FieldMapping` rows are the union of all regions' column bindings (deduplicated by `ColumnDefinition`).

When a region's bindings conflict with another region's bindings for the same `ColumnDefinition` (rare; both regions provide values for the same field), the merged binding records the per-region source locators; the extractor emits per-region records and the `entity_records` write path handles union semantics as it does today.

### New table: `connector_instance_layout_plans`

```ts
// apps/api/src/db/schema/connector-instance-layout-plans.table.ts
export const connectorInstanceLayoutPlans = pgTable("connector_instance_layout_plans", {
  ...baseColumns,
  connectorInstanceId: uuid("connector_instance_id").notNull().references(() => connectorInstances.id),
  planVersion: text("plan_version").notNull(),       // semver from LayoutPlan
  revisionTag: text("revision_tag"),                 // remote etag/revisionId (Mode B only, nullable for Mode A)
  plan: jsonb("plan").$type<LayoutPlan>().notNull(), // full plan, Zod-validated at boundary
  interpretationTrace: jsonb("interpretation_trace"),// checkpointed stage artifacts
  supersededBy: uuid("superseded_by"),               // self-FK to the next plan version, null if current
});
```

Index on `(connectorInstanceId, supersededBy)` for "fetch current plan."

Repository: `ConnectorInstanceLayoutPlanRepository` extends `Repository<...>`. Standard soft-delete semantics apply.

Mode A note: snapshot uploads may skip persistence entirely — the plan is computed, used to drive extraction, and optionally archived for audit. If archived, it is stored in this same table with `supersededBy` left null and no subsequent records.

### `sync_history` (or equivalent)

Add a nullable `layout_plan_id` FK column so each sync run can link back to the plan version used. Existing non-plan syncs leave this null.

## Sync integration with `FileUploadConnector`

Current sync path (simple-layout): parse CSV/XLSX → map columns by header name → write `entity_records`. Remains the default for files that don't need the parser.

New sync path (plan-driven):

1. On first upload (or "re-analyze" action), the workflow calls the file-upload connector's API:
   - `POST /api/connector-instances/:id/layout-plan/interpret` with the adapted `Workbook` payload and optional `regionHints`.
   - Backend builds `InterpretInput`, calls `interpret()`, persists the plan with `supersededBy: null`.
   - Returns the plan + `interpretationTrace` for the UI review step.
2. User reviews, optionally edits bindings/regions, confirms. Backend updates the plan in-place before commit.
3. Commit endpoint: `POST /api/connector-instances/:id/layout-plan/:planId/commit`.
   - Loads the adapted workbook from the upload.
   - Calls `replay(plan, workbook)`.
   - Groups `ExtractedRecord`s by `targetEntityDefinitionId`, upserts `ConnectorEntity` rows, reconciles `FieldMapping` per entity, writes `entity_records`.
   - Links the sync history row to `layout_plan_id`.
4. Subsequent uploads re-run step 1; Mode A always produces a fresh plan.

Mode B consumers follow the same endpoints but also accept scheduled-sync triggers that call `replay` directly against the stored plan and only call `interpret()` when `DriftReport.severity >= "warn"` or `identityChanging` is true.

### Drift gating

The backend never commits records when:

- `DriftReport.identityChanging === true` — returns `409` with the drift report; the frontend must route the user into a review flow.
- `DriftReport.severity === "blocker"` — same.

Warnings at `warn` severity without identity change commit automatically if the region's drift knobs allow, or halt with `409` if knobs require halt (the default).

## Testing

### Fixture-based regression

`packages/spreadsheet-parsing/src/__tests__/fixtures/` contains irregular spreadsheet fixtures with expected plans and expected confidence/warning signals. New fixtures are added whenever a real customer file exposes a new shape. Regression checks:

- Stage functions run in isolation against recorded state slices (no LLM call; mocked model output).
- `replay()` runs against fixture workbooks + stored plans; output records are snapshot-compared.
- Drift tests flip cells in fixture workbooks and assert the generated `DriftReport`.

### Integration tests

Under `apps/api/src/__tests__/spreadsheet-parsing/`:

- `interpret` endpoint: mock the LLM, verify plan persistence and trace checkpointing.
- `commit` endpoint: replay + `entity_records` write. Hit the real database per the project's integration-test rule.
- Drift on second sync: seed a prior plan, mutate the uploaded workbook, assert `409` behavior.

### Cost observability

`interpret()` emits structured logs with token counts (input/output) per stage. Used to validate the cost envelope (architecture OQ2).

## Open questions (backend-owned)

- Concrete threshold bands for `severity`: where do green/yellow/red cut off, and which warning codes are `blocker` by default?
- Interpretation cost envelope: max input size (cells × sheets) before we chunk or sample. Applies to `interpret()` and to `recommendRecordsAxisName`.
- Sheet classification for unhinted sheets: prompt strategy or heuristic?
- Identity drift semantics for pivoted regions when a records-axis value is renamed vs replaced vs reordered (architecture OQ1).
- Hinted-bounds drift policy: which drift-knob default applies to `BOUNDS_OVERFLOW` (architecture OQ7)?
