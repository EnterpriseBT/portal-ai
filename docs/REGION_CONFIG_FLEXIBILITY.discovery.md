# Region Configuration Flexibility — Discovery

## Problem

The current region model assigns a single role to every cell along the
`headerAxis` line: either *all* cells are field names (non-pivoted) or *all*
cells are records-axis labels (pivoted). Real spreadsheets routinely mix
both roles in the same header line, and frequently carry multiple
independent pivot dimensions simultaneously.

Canonical failing pattern (`rows-as-records + headerAxis:row`):

```
name    industry    Q1    Q2    Q3   Jan   Feb   Mar
---------------------------------------------------
Apple   Tech       100   200   300   30    30    60
```

Desired extraction for one data row: **6 records**, each carrying the two
static attributes plus one segment's axis-label / value pair.

```
{ name: "Apple", industry: "Tech", quarter: "Q1",  quarterTotal: 100 }
{ name: "Apple", industry: "Tech", quarter: "Q2",  quarterTotal: 200 }
{ name: "Apple", industry: "Tech", quarter: "Q3",  quarterTotal: 300 }
{ name: "Apple", industry: "Tech", month:   "Jan", monthlyTotal: 30  }
{ name: "Apple", industry: "Tech", month:   "Feb", monthlyTotal: 30  }
{ name: "Apple", industry: "Tech", month:   "Mar", monthlyTotal: 60  }
```

Today neither `headerAxis:row` (all-field, produces 1 fat record) nor the
pivoted single-segment interpretation (all-axis-label, fails on `name` and
`industry` since they aren't labels) is correct.

The transpose applies identically — `columns-as-records + headerAxis:column`
with the same data shape rotated 90°:

```
name      Apple
industry  Tech
Q1        100
Q2        200
Q3        300
Jan       30
Feb       30
Mar       60
```

Here the header line is column 1; some rows are `static field` (`name`,
`industry`), some are pivot labels in segments `quarter` (rows 3-5) and
`month` (rows 6-8). The model must be symmetric: every design element
below that refers to "column" in the row-orientation case has a mirror in
"row" in the column-orientation case.

## Mental model

- A region's `headerAxis` defines **one line of cells** — a row (if
  `headerAxis: "row"`) or a column (if `headerAxis: "column"`).
- Each cell along that line is a **position**.
- Each position has a **role**: either `field` (static attribute), a member
  of a **pivot segment**, or `skip`.
- A segment groups contiguous-or-non-contiguous positions that share an
  axis name + value field name (e.g. `quarter` + `quarterTotal`).

The existing taxonomy collapses to degenerate cases:
- Current non-pivoted = every position has role `field`.
- Current pivoted single-axis = every position has role `pivotLabel` under
  one auto-segment named by `recordsAxisName`; value field named by
  `cellValueName`.

Option A generalizes: a region is **segmented** when positions mix roles
or carry more than one pivot segment. Everything else is a special case.

## Simplifying constraints

Two model-wide constraints ride alongside the segmented-region work.
Neither is strictly about segmentation — they're prerequisite
simplifications that make segmented records reconcilable and make
cross-connector references unambiguous.

### C1. One region per entity (inside a connector instance)

**Rule:** within a single `connector_instance`, every region has a
**unique** `targetEntityDefinitionId`. Two regions may not target the
same entity.

**Why:**

- Today, regions sharing a target merge into one entity (see
  `SPREADSHEET_PARSING.architecture.spec.md` § "Region → entity merge
  model"). Record unions, field-mapping reconciliation, and identity
  strategy all operate per merged entity.
- Segmented records multiply the failure modes of merging:
  schema-divergent segments, per-segment identity strategies, segment-id
  collisions across regions, drift that affects one region but not
  another — each of which has to be reconciled at commit time before
  the entity can be written coherently.
- The UX cost of dropping the merge is small — users who want "the
  same entity populated from two regions" can achieve the same thing
  by drawing one larger region that covers both, or by creating two
  distinct entities and cross-referencing (which C2 enables).

**Enforcement points:**

- **Editor validation** — the region configuration panel's entity
  picker greys out entities already claimed by another region in the
  same workflow. Validation blocks Interpret if a duplicate is
  introduced (e.g., via rename).
- **Commit-time API validation** — reject plans with duplicate
  `targetEntityDefinitionId` inside a connector's regions, returning a
  clear error code (new `LAYOUT_PLAN_DUPLICATE_ENTITY`).
- **Parser** — the interpret pipeline's `score-and-warn` emits a
  `DUPLICATE_ENTITY_TARGET` blocker when hints share a target id.

**Code to remove:**

- `layout-plan-commit.service.ts` groups regions by
  `targetEntityDefinitionId` before calling `reconcileFieldMappings`.
  Under C1 each group has exactly one region — the grouping code stays
  as the source of truth for "which ConnectorEntity this region becomes"
  but the merge semantics disappear.
- `SPREADSHEET_PARSING.architecture.spec.md` § "Region → entity merge
  model" needs a rewrite: one region, one entity, period.

### C2. Entity key unique per organization

**Rule:** every `ConnectorEntity.key` is **unique within the
organization**, not merely within a connector instance. Each connector
still owns its own set of entities — entities are not shared across
connectors. The org-wide uniqueness is purely a **lookup-space
guarantee**: any `refEntityKey` on a FieldMapping resolves to exactly
one entity org-wide.

**Why:**

- Reference `ColumnDefinition`s resolve by `refEntityKey`. Today's
  resolver already walks the org-wide `ConnectorEntity` table (see
  `reconcileFieldMappings` § reference validation) but the underlying
  unique index is `(organization_id, connector_instance_id, key)`. If
  two connectors happen to mint `key = "customers"`, the ref lookup is
  ambiguous and the first-returned row wins — silent wrong-entity
  join.
- Raising the uniqueness boundary to the org ensures the ref resolves
  to exactly one entity. That entity may live in any connector in the
  org; the `refEntityKey` is its opaque handle, nothing more.
- There is no cross-connector append / shared entity concept. A
  connector's entity is private to that connector; org-wide uniqueness
  exists so that *other* connectors can point at it by key, not write
  into it.

**Schema change:**

- Drop `UNIQUE(organization_id, connector_instance_id, key)` on
  `connector_entities`.
- Add `UNIQUE(organization_id, key) WHERE deleted IS NULL` (partial
  index so soft-deleted keys free up for reuse).

**Migration:**

- Audit existing rows per org for key collisions. Expected count: very
  small given the connector is still new. Collision resolution is
  manual — auto-rename risks breaking references silently.
- Block the migration on a dry-run that reports any org with
  duplicates; the affected orgs need a support-led rename before the
  migration proceeds.

**API impact:**

- Commit-time entity upsert today keys on `(connectorInstanceId, key)`
  via `DbService.repository.connectorEntities.upsertByKey`. Changes to
  `(organizationId, key)`; upsert still *only* touches entities inside
  the current connector instance — the index just guarantees there
  isn't a same-keyed entity elsewhere in the org.
- Plan commit fails with a clear error
  (`CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR`) when another
  connector in the same org already owns the target key. User must
  pick a different key. There is no "take over" or "merge" semantic —
  entities remain per-connector; only the key namespace is shared.
- Reference validation in `reconcileFieldMappings` simplifies: one
  org-wide lookup, no ambiguity, drop the "first row wins" fallback.

**UI impact:**

- The entity picker's option list is fed by `sdk.connectorEntities.search()`
  which already returns org-wide options. The picker shows the owning
  connector in the option label so users see which connector owns the
  key. Picking an existing option means "reference this other
  connector's entity", not "write records into it".
- Staged-entity creation in the region editor validates the chosen
  key against the org-wide namespace and blocks when it collides with
  a key owned by another connector, prompting the user to rename.

**Ordering vs. segmentation work:**

- C1 and C2 are prerequisites for segmented regions. Segmentation's
  phase 1 (schema + replay) assumes them — the record-identity
  derivation and FieldMapping reconciliation in the segmented codepath
  rely on "this region owns this entity" and "this key means exactly
  one entity org-wide".
- Both constraints are independently useful even if segmentation
  slips. They could ship first as their own PR.

## Crosstab treatment

`cells-as-records` regions (crosstabs) are a third orientation alongside
rows-as-records and columns-as-records. They carry **two** header lines
— the row-header and the column-header — and every cell at their
intersection is a record. Today crosstabs use three flat names
(`recordsAxisName`, `secondaryRecordsAxisName`, `cellValueName`), not
segmentation.

### Where segmentation would extend crosstabs

The segmented mental model generalizes naturally to 2D: each header
line (row line and col line) gets its own `positionRoles[]` and its own
`pivotSegments[]`. Record emission rules for a fully segmented crosstab
would be:

- A record is emitted only for cells whose **row** position has role
  `pivotLabel` **and** whose **col** position has role `pivotLabel`.
- `field` (static) positions on either axis contribute their cell value
  into every record whose row or column intersects them. In effect:
  a row-line static replicates across every column-record in that row;
  a col-line static replicates across every row-record in that column.
- `skip` positions are ignored for record emission, from either axis.
- Cells at `(static, static)` intersections don't belong to any record
  and are dropped as metadata.

This is strictly more expressive than today's crosstab and absorbs two
patterns the current model can't express:

1. **Static-prefix crosstab** — a crosstab with leading label columns
   that describe the row (e.g., `count` column before `Region1..3`
   cells). Under segmentation the prefix columns are `field`-role
   positions on the col-line; they replicate into every cell record.
2. **Skip totals row/col** — most real-world crosstabs have a `Total`
   row or column that isn't a legitimate records-axis value. `skip`
   role covers this uniformly.

### v1 scope: keep crosstabs flat

For v1 we **do not** ship segmented crosstabs. Reasons:

- Crosstabs are already the hardest orientation to configure; layering
  two dimensions of segmentation on top is a big UX and parser lift.
- The canonical failing pattern this discovery is built around
  (mixed static + multi-pivot header on one axis) is expressible with
  rows-as-records / columns-as-records + segmentation — crosstab isn't
  required to solve it.
- Phase 1's fixture matrix gets unwieldy if we try to cover 1D and 2D
  segmentation at once; better to lock in the 1D semantics first.

Enforcement for v1:

- Parser schema: `positionRoles` / `pivotSegments` are **not permitted**
  on regions where `orientation === "cells-as-records"`. Zod refinement
  rejects them; commit-time validation returns a clear error.
- Crosstabs continue to use the existing three flat names. The review
  editor's crosstab config stays unchanged.
- Frontend role-strip UI is hidden for cells-as-records regions.

### v2 path (deferred)

When the 2D extension is ready, the upgrade is additive:

- Relax the Zod refinement: segmented crosstabs accept per-axis
  `positionRoles`/`pivotSegments` (two sets, one per axis). The three
  flat names remain as the "single-segment-per-axis" legacy form.
- Record emission code branches on `(row-segmented?, col-segmented?)`
  — four combinations, three of which reduce to the v1 code path.
- UI grows a second role strip (along the row-header edge) mirroring
  the column one.
- The "multiple `cellValueName`s" case — different (rowSegment,
  colSegment) pairs carrying different value semantics like
  `revenue` vs. `headcount` — stays an open question even in v2;
  first cut uses a single per-region `cellValueName` and adds
  per-col-segment `valueFieldName` later if needed.

Callouts for v1 that keep v2 reachable:

- The row-line-axis roles and the col-line-axis roles should live in
  **separate** fields when we add them (`rowPositionRoles`,
  `colPositionRoles`), not in a single `positionRoles`. This avoids
  ambiguity when both exist.
- Segment ids should be scoped to a region but globally unique across
  axes within that region (`segmentId: string`), so future merging /
  reporting is coherent.
- `pivotSegments: PivotSegment[]` stays a flat region-level list; each
  segment declares which axis it belongs to via a `axis: "row" | "col"`
  field in the v2 schema. v1 can omit that field (implicit
  `axis: "col"` or `axis: "row"` based on the region's `headerAxis`).

### Interaction with C1 and C2

Neither C1 (one region per entity) nor C2 (org-wide unique entity keys)
has special-case behavior for crosstabs — each crosstab is one region
targeting one entity; its key sits in the same org-wide uniqueness
namespace as any other entity. The crosstab exemption is purely about
*segmentation*, not about the two simplifying constraints.

## Permutation matrix

The intent of segmentation is to cover every combination of orientation,
headerAxis, and per-position role pattern that real spreadsheets
produce. The table below enumerates them and states the v1 scope. Each
in-scope row has a concrete example in
`docs/fixtures/region-segmentation-matrix.csv` under the matching id.

Legend:
- **Orientation** — `rows` = rows-as-records, `cols` = columns-as-records,
  `cells` = cells-as-records (crosstab).
- **HeaderAxis** — `row`, `col`, or `none`.
- **Role pattern** describes how the headerAxis positions are tagged:
  - `all-field` — every position is a standard field (non-pivoted today).
  - `all-pivot` — every position is a records-axis label (pivoted today).
  - `N-segments` — multiple independent pivot segments on the same
    headerAxis line.
  - `mixed:N` — some `field` positions + N pivot segments.
  - `+skip` — any of above with at least one `skip` position.

| id  | Orientation | HeaderAxis | Role pattern                              | In scope | Notes                                    |
|-----|-------------|------------|-------------------------------------------|----------|------------------------------------------|
| 1a  | rows        | row        | all-field (degenerate)                    | ✅       | Existing: classic tidy                   |
| 1b  | rows        | row        | all-pivot 1 segment                       | ✅       | New segmented encoding of existing shape |
| 1c  | rows        | row        | 2-segments, no statics                    | ✅       | New                                      |
| 1d  | rows        | row        | mixed: statics + 1 segment                | ✅       | New                                      |
| 1e  | rows        | row        | mixed: statics + 2 segments **canonical** | ✅       | New — the motivating case                |
| 1f  | rows        | row        | mixed + skip (e.g. Total col)             | ✅       | New                                      |
| 2a  | cols        | col        | all-field (degenerate)                    | ✅       | Existing: transposed tidy                |
| 2b  | cols        | col        | all-pivot 1 segment                       | ✅       | New segmented encoding                   |
| 2c  | cols        | col        | 2-segments, no statics                    | ✅       | New                                      |
| 2d  | cols        | col        | mixed: statics + 1 segment                | ✅       | New                                      |
| 2e  | cols        | col        | mixed: statics + 2 segments               | ✅       | New — canonical transpose                |
| 2f  | cols        | col        | mixed + skip                              | ✅       | New                                      |
| 3a  | rows        | col        | all-pivot 1 segment (existing pivoted)    | ✅       | Existing                                 |
| 3b  | rows        | col        | N-segments (multi records-axis)           | ✅       | New — split one records-axis into N      |
| 4a  | cols        | row        | all-pivot 1 segment (existing pivoted)    | ✅       | Existing                                 |
| 4b  | cols        | row        | N-segments (multi records-axis)           | ✅       | New                                      |
| 5   | rows        | none       | headerless                                | ✅       | Existing; segmentation N/A               |
| 6   | cols        | none       | headerless                                | ✅       | Existing; segmentation N/A               |
| 7   | cells       | (2D)       | flat crosstab                             | ✅       | Existing; no segmentation in v1          |
| 8   | cells       | (2D)       | static-prefix / segmented crosstab        | 🔒 v2    | Deferred — see "Crosstab treatment"      |

Notes on the "new" rows:

- **1b / 2b** formally duplicate the existing pivoted shape but under
  the segmented encoding (one implicit segment covering every
  position). They're listed so the phase-1 parser can round-trip a
  pivoted region through segmentation without behavior change.
- **1c / 2c** is the "multiple pivots, no statics" case — two
  independent records-axes share a non-pivoted base but drop the
  static prefix. Rare but falls out of the same model.
- **3b / 4b** ("multi records-axis") is the pivoted analogue: the
  existing pivoted shape already assigns records-axis labels on
  `headerAxis`; segmentation there splits those labels into multiple
  named axes. Each segment gets its own axis-name; each position is
  still exactly one record.
- **8** (segmented crosstab) stays deferred. See § "Crosstab
  treatment".

The CSV companion gives hand-crafted data for each ✅ row so reviewers
can see at a glance what the feature covers and so fixture-based tests
have a canonical source.

## Schema additions (spreadsheet-parsing)

New optional fields on `Region` in
`packages/spreadsheet-parsing/src/plan/region.schema.ts`. All absent-by-default,
so existing plans remain valid.

```ts
// One entry per position along the headerAxis, in document order.
// Length === bounds.endCol - bounds.startCol + 1  (for headerAxis:row)
// Length === bounds.endRow - bounds.startRow + 1  (for headerAxis:column)
type AxisPositionRole =
  | { kind: "field" }      // static attribute; populates every derived record
  | { kind: "pivotLabel"; segmentId: string }
  | { kind: "skip" };      // ignored at extraction time

interface PivotSegment {
  id: string;                 // stable within region
  axisName: string;           // required — e.g. "quarter"
  axisNameSource: "user" | "ai" | "anchor-cell";
  valueFieldName: string;     // required — e.g. "quarterTotal"
  valueFieldNameSource: "user" | "ai" | "anchor-cell";
  // Optional: bind the valueFieldName to a ColumnDefinition so downstream
  // FieldMapping rows target a real column.
  valueColumnDefinitionId?: string;
}

interface Region {
  // ...existing fields...
  positionRoles?: AxisPositionRole[];
  pivotSegments?: PivotSegment[];
  // `columnBindings` continues to bind `field`-role positions to
  // ColumnDefinition ids. Positions under `pivotLabel` have no individual
  // binding — they contribute under their segment's valueFieldName.
}
```

Segment id is a slug/uuid; user-facing names live in `axisName` and
`valueFieldName`. Anchor-cell auto-populate (similar to today's
`recordsAxisName`) seeds names tentatively; only `source: "user"` values
are considered committed and flow into `regionHints`.

## Record generation semantics

Given `entityUnits = rows` when `rows-as-records` / `columns` when
`columns-as-records`, and `positions = columns` when `headerAxis: "row"` /
`rows` when `headerAxis: "column"`:

```
for each entity-unit e:
  statics = { for each position p with role "field":
                binding(p).columnDefinitionId → cellValue(e, p) }
  for each segment s in pivotSegments:
    for each position p with role { pivotLabel, segmentId = s.id }:
      emit {
        ...statics,
        [s.axisName]: headerLabel(p),
        [s.valueFieldName]: cellValue(e, p),
      }
```

Record count per entity-unit = Σ over segments of that segment's position
count. Static positions contribute no records; they only contribute fields.

**Edge cases handled naturally:**
- No segments → behaves as today's non-pivoted region (1 record per entity-unit, all fields from `field` positions).
- One segment, no `field` positions → behaves as today's pivoted region.
- Crosstab (`cells-as-records`) stays its own orientation; segmentation is
  for the two linear orientations. Future work: segmented crosstab could
  layer on top, but out of scope here.

## Orientation symmetry

The schema names `positionRoles` and `pivotSegments` rather than anything
column- or row-prefixed precisely so the two orientations share a single
mechanism. The interpretation:

| orientation | headerAxis | positions index over | entityUnits index over |
|---|---|---|---|
| rows-as-records | row | columns | data rows (rows after header) |
| rows-as-records | column | rows of the header column **(pivoted today; staged)** | data cols, with records-axis labels inside the headerAxis column |
| columns-as-records | column | rows | data columns (cols after header) |
| columns-as-records | row | columns of the header row **(pivoted today; staged)** | data rows, with records-axis labels inside the headerAxis row |

All four combinations accept `positionRoles` with identical meaning. UI
must present the role strip along the correct axis for whichever
headerAxis the region uses.

## Schema union vs. discriminated schema (open question)

When records from different segments are merged into one entity at commit,
do we want:

**Option 1 — sparse unioned schema** (recommended):
Each record carries only the fields its segment populates, plus all
statics. At commit, the entity's column set is `(all statics) ∪ (each
segment's axisName and valueFieldName)`. A `Q1` record has the `quarter`
and `quarterTotal` columns populated and the `month` / `monthlyTotal`
columns null. This is the shape the user example implies.

**Option 2 — strict per-segment entity**:
Different segments produce different entities. Each segment becomes its
own `connector_entity` with its own column set. Requires either multiple
`targetEntityDefinitionId`s per region (new) or multiple regions sharing
bounds (awkward).

I recommend Option 1. Simpler mental model, matches the user's stated
expected output, and aligns with how `cells-as-records` already produces
sparse records with partial schema overlap. Commit-side `FieldMapping`
creation already handles the sparse case since each record's `fields`
map is already dense-in-what-it-populates, sparse-in-what-it-doesn't.

## UI surface

### The role strip
After drawing a region and choosing orientation + headerAxis, the
configuration panel shows a **role strip** along the header line — one
chip per position, labeled with the cell's text. Each chip has a role
picker:

```
┌─────────┬──────────┬─────┬─────┬─────┬─────┬─────┬─────┐
│ [Field] │ [Field]  │ [Q] │ [Q] │ [Q] │ [M] │ [M] │ [M] │
│  name   │ industry │ Q1  │ Q2  │ Q3  │ Jan │ Feb │ Mar │
└─────────┴──────────┴─────┴─────┴─────┴─────┴─────┴─────┘
```

Per-chip controls:
- Three-way toggle: **Field** | **Pivot** | **Skip**
- When Pivot: dropdown of existing segments + "New segment". Color-coded
  so same-segment chips share a hue (reusing `colorForEntity` palette).
- Multi-select + bulk-apply: shift-click a range, set role once.

Below the strip, one expandable card per segment with:
- `axisName` text field (required; auto-populated from anchor, user
  override persists as `source: "user"`)
- `valueFieldName` text field (required)
- Optional `valueColumnDefinitionId` picker (binds the segment's value
  field to a real ColumnDefinition)
- List of member positions (read-only, for review)

### For `headerAxis: "column"`
The strip renders vertically along the left edge of the canvas region.
Same controls, rotated 90°. No other UX differences.

### Relationship to existing editor controls
- `recordsAxisName` becomes a **per-segment** axisName. For
  backward-compat, non-segmented regions with a single pivot continue to
  round-trip through the existing `recordsAxisName` field; `pivotSegments`
  is the new home for segmented regions. `recordsAxisName` can stay as a
  synonym for "segment 0's axisName" when exactly one segment exists.
- `cellValueName` becomes **per-segment** `valueFieldName` similarly.
- `columnBindings` continues to exist — each `field`-role position binds
  to one `columnDefinitionId` there. `pivotLabel` positions are absent
  from `columnBindings`.

## Interpret pipeline changes

### `detect-headers.ts`
Unchanged at the candidate-detection level (still finds the field-names
axis for pivoted, the header-line axis for non-pivoted). What changes is
that the *whole line* no longer implies a uniform role.

### New stage — `detect-position-roles.ts`
Pass that assigns an initial role to each position. Heuristics:

- Cells matching patterns like `Q\d`, month names, `YYYY`, `MM/DD` →
  `pivotLabel` candidate; cluster contiguous same-pattern cells into
  one segment.
- Cells that look like normal identifiers (multi-word names, snake_case,
  title-case domain words) → `field` candidate.
- Mixed / ambiguous → leave unassigned; LLM resolves.

Segment boundaries default to contiguous-same-pattern runs. User can
merge/split in the UI.

### LLM refinement — `classify-positions.ts`
Replaces today's `classify-columns` for segmented regions. Takes the
per-position heuristic output + each position's samples and returns:

- For `field`: `columnDefinitionId` (as today).
- For `pivotLabel`: `segmentId` assignment and the segment's proposed
  `axisName` + `valueFieldName` (guidance: "these column labels look like
  time periods; call them the 'month' axis with a 'monthlyTotal' value").

Non-segmented regions (all `field` or all `pivotLabel`) retain today's
pipeline unchanged — the new stage short-circuits when a single role is
inferred for every position.

### `recommend-records-axis-name.ts`
Fires per-segment instead of per-region. Each segment's axis labels are
collected and sent to the recommender independently, producing per-segment
`axisName` suggestions.

## Replay pipeline changes

`extract-records.ts` branches early on presence of `positionRoles`:

```ts
if (region.positionRoles && region.pivotSegments) {
  return extractSegmentedRecords(region, sheet);
}
// existing branches: rows-as-records / columns-as-records / cells-as-records
```

`extractSegmentedRecords` implements the semantics section above. Identity
strategy (source_id derivation) now operates per (entity-unit, segment,
position) triple — source_id must encode enough to be stable across
re-syncs. Simplest derivation: `{entityId}/{segmentId}/{position.label}`.

## Validation

- Every `pivotLabel` position must reference an existing `segmentId`.
- Every `field` position should bind to a ColumnDefinition (warn if not).
- Every segment needs non-empty `axisName` and `valueFieldName`.
- No two segments may share an `axisName` within a region (collision →
  records would overwrite on merge).
- `positionRoles` length must equal the header-line length in bounds.
- Warnings surface under the same blockers/warnings mechanism the
  existing validator uses.

## Backward compatibility

- No change to existing plans. Regions without `positionRoles` follow
  today's pipeline exactly.
- Existing `recordsAxisName` / `cellValueName` fields stay. New regions
  that are single-segment can be represented either way; the interpret
  pipeline produces the legacy form when `positionRoles` isn't needed
  (every cell is one role under one segment), to keep plans readable.
- Frontend drift detection: plan-version bump when segmented regions are
  introduced so older clients don't silently render broken state.

## Phasing

Two prerequisite phases (the constraints above) ship before segmentation
can land coherently. Each is independently useful.

0a. **One region per entity (C1)** — add frontend + commit-time
   validation, emit `DUPLICATE_ENTITY_TARGET` from the parser, strike
   the merge semantics from `SPREADSHEET_PARSING.architecture.spec.md`,
   and simplify `layout-plan-commit.service.ts`'s grouping. Small PR;
   ships on its own regardless of whether segmentation proceeds.

0b. **Org-wide entity key uniqueness (C2)** — DB migration + dry-run
   duplicate audit, update the unique index, adjust
   `upsertByKey` to key on `(organizationId, key)`, tighten reference
   validation to the org-unique resolver, add the "key already owned
   by another connector" error path. Ships on its own; references
   become unambiguous across connectors immediately.

1. **Schema + replay (linear orientations only)** — add `positionRoles`
   / `pivotSegments` to the Zod schema with a Zod refinement that
   rejects them when `orientation === "cells-as-records"`. Implement
   `extractSegmentedRecords` for rows-as-records and columns-as-records.
   Plans constructed by hand work end-to-end. No interpret or UI
   support yet. Confirms the 1D semantics. Depends on 0a and 0b.
   Crosstab segmentation is explicitly deferred — see "Crosstab
   treatment" section for the v2 path.
2. **Interpret — heuristic** — `detect-position-roles` pass generates
   initial roles from patterns (quarter/month/year regex banks). No
   LLM yet. Ship behind a per-region opt-in flag so the legacy
   pipeline remains the default.
3. **UI — role strip** — render the chips + role picker in the region
   configuration panel. User can opt into segmentation post-interpret.
   LLM still not involved.
4. **Interpret — LLM classifier** — `classify-positions` sub-prompt.
   Ship once heuristic + UI shake-out establishes the data model.
5. **Flip default** — once live usage confirms the design, the
   non-segmented single-pivot codepath becomes a special case rendered
   by the same segmented machinery. `recordsAxisName` / `cellValueName`
   become computed views over the single-segment case.

Phase 1 is the smallest segmentation-shippable unit. Phases 0a and 0b
can ship in either order or in parallel and are valuable independently
of the segmentation work.

## Open questions

1. **Identity under segments** — is `{entity}/{segmentId}/{label}` stable
   enough as `source_id`? What happens when a user renames a segment
   (`quarter` → `fiscalQuarter`)? Probably drift-detection with manual
   confirmation, same shape as axis-name renames today.
2. **Partial binding of segment values** — should `valueColumnDefinitionId`
   be required, optional, or inferred? If a user doesn't bind the
   segment's value field, FieldMapping creation has nothing to target.
   Simplest: require binding, like `field` positions.
3. **Composite statics** — can a static position also be a pivot key for
   a *different* entity (e.g. a region split by `industry` into separate
   rollups)? Out of scope for v1; revisit if patterns emerge.
4. **Skip role reach** — is `skip` strictly for positions the user wants
   ignored at extraction, or does it also interact with header detection
   / drift? Cleanest to treat it as extraction-only: detected as normal,
   ignored at record emit time.
5. **Segmented crosstabs in v2** — the "Crosstab treatment" section
   sketches the 2D generalization but leaves the "multiple
   `cellValueName`s per region" case open. Different (rowSegment,
   colSegment) intersections could carry different value semantics
   (revenue vs. headcount); first v2 cut likely keeps one per-region
   cellValueName and graduates only if real patterns demand it.
6. **C2 rename UX on collision** — when a user's chosen entity key
   collides with another connector's existing key, the API rejects
   and the user must pick a new one. Do we want a sharper UX than
   just surfacing the error string — e.g., auto-suggest a
   non-colliding variant (`customers_2`), or let the user select the
   existing entity and promote their intent to a reference? The
   rule itself is not in question (no cross-connector append exists),
   only how graceful the failure is.
7. **C2 migration audit** — what's the right remediation UX when the
   pre-migration audit finds an org with colliding keys? Candidates:
   support-led rename (simplest, requires one human touch per affected
   org), inline "resolve conflicts" page in the product (more surface
   area), or disable the impacted connectors until resolved. Likely
   support-led given expected volume.

## Specs

The discovery has been split into five focused specs, each sized for a
single PR. Ship in the order below; the first two are independent of
segmentation and valuable on their own.

| Spec                                               | Scope                                                                          | Depends on    |
|----------------------------------------------------|--------------------------------------------------------------------------------|---------------|
| `REGION_CONFIG.c1_one_region_per_entity.spec.md`   | C1: enforce one region per `targetEntityDefinitionId` per connector instance   | —             |
| `REGION_CONFIG.c2_org_unique_entity_key.spec.md`   | C2: unique `(organization_id, key)` index + audit + error code + UI affordance | —             |
| `REGION_CONFIG.schema_replay.spec.md`              | Segmentation phase 1 — Zod schema + replay `extractSegmentedRecords`           | C1, C2        |
| `REGION_CONFIG.interpret.spec.md`                  | Segmentation phases 2 + 4 — heuristic role detection + LLM classify/recommend  | schema_replay |
| `REGION_CONFIG.ui.spec.md`                         | Segmentation phase 3 — role strip, segment management card, validation         | schema_replay, interpret |

Each spec includes its own test plan and acceptance criteria; none
restate the rationale — they reference this discovery for the "why".

Segmented crosstabs (matrix row 8) stay deferred; they get their own
discovery → spec → plan arc when scheduled. The v1 Zod refinement in
`schema_replay` enforces the deferral.

A `.plan.md` breaking the specs into sequenced PRs with ready-to-go
test matrices is a reasonable next artifact once the specs have been
reviewed.
