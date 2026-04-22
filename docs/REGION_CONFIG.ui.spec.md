# Region Segmentation — Role Strip UI

Render segmented regions in the editor. Users can view + edit the
per-position role assignments, manage `pivotSegments`, and see the
downstream record expansion preview. Surfaces the opt-in flag to the
interpret endpoint.

Context: `docs/REGION_CONFIG_FLEXIBILITY.discovery.md` § "UI surface".

## Prerequisites

- `REGION_CONFIG.schema_replay.spec.md` merged — schema + extraction
  accept segmentation.
- `REGION_CONFIG.interpret.spec.md` merged — the interpret endpoint
  can emit segmented plans when `enableSegmentation: true` is set.

## New components (apps/web)

### `RoleStrip.component.tsx`

Location: `apps/web/src/modules/RegionEditor/RoleStrip.component.tsx`.

Props (pure UI, no SDK dependency):

```ts
interface RoleStripUIProps {
  /** Cell labels along the header axis, in document order. */
  labels: string[];
  /** Current role for each label. */
  roles: AxisPositionRole[];
  /** All known segments on this region. */
  segments: PivotSegmentDraft[];
  /** The axis the strip runs along — "row" or "column". */
  axis: "row" | "column";
  /** Called with a new roles array when the user edits a role. */
  onRolesChange: (next: AxisPositionRole[]) => void;
  /** Called when the user creates a new segment from bulk-selection. */
  onCreateSegment: (positions: number[]) => void;
  /** Called to rename or delete a segment. */
  onUpdateSegment: (id: string, patch: Partial<PivotSegmentDraft>) => void;
  onDeleteSegment: (id: string) => void;
}
```

Render:

- Horizontal strip of chips when `axis === "row"` (one chip per
  column); vertical strip when `axis === "column"`.
- Each chip shows: cell label (truncated w/ title attr for long),
  role icon (Field / Pivot / Skip), and — for pivot roles —
  a color dot for the segment (reuses `colorForEntity` palette).
- Per-chip click opens a popover with the three-way role toggle +
  segment dropdown (when Pivot is selected).
- Multi-select: shift-click extends selection; drag-select across
  adjacent chips; bulk-assign via a toolbar action ("Group as
  segment").
- Skip positions render muted grey.

### `SegmentManagementCard.component.tsx`

Location:
`apps/web/src/modules/RegionEditor/SegmentManagementCard.component.tsx`.

Props:

```ts
interface SegmentManagementCardUIProps {
  segment: PivotSegmentDraft;
  memberLabels: string[];            // read-only list of member cell labels
  errors?: FormErrors;
  onChange: (patch: Partial<PivotSegmentDraft>) => void;
  onDelete: () => void;
  columnDefinitionSearch?: SearchResult<SelectOption>;
}
```

Render:

- `axisName` text field (required; respects the source-gate from the
  existing `recordsAxisName` infra — `source: "user"` marks
  confirmed).
- `valueFieldName` text field (required).
- Optional `valueColumnDefinitionId` via the existing
  `AsyncSearchableSelect` picker (same as binding-editor popover).
- Read-only member list with color dot.
- Delete button with confirmation.

## Changed components

### `RegionConfigurationPanel.component.tsx`

Extend the props + render:

- New props: `positionRoles`, `pivotSegments`, role/segment callbacks
  mirroring `RoleStripUIProps` + `SegmentManagementCardUIProps`.
- Render order inside the panel:
  1. Entity picker (existing; now with owning-connector label from
     C2 spec).
  2. Orientation + headerAxis pickers (existing).
  3. **RoleStrip** — only when `headerAxis !== "none"` and the
     region is not a crosstab. Strip is hidden for
     `cells-as-records` regions.
  4. **SegmentManagementCard** list — one per segment in
     `pivotSegments`. Empty list when no segments defined.
  5. Existing `recordsAxisName` editor — shown **only** for legacy
     single-segment pivoted regions (back-compat for
     non-segmented plans). Hidden once a region has segmentation
     applied.
  6. Skip rules / bounds / etc. (existing).

### `FileUploadConnectorWorkflow.component.tsx` (container)

- Default `enableSegmentation: true` on every `regionHint` for the
  interpret call. Segmented plans come back automatically.
- Wire the role-strip callbacks through to the workflow hook's
  existing `onRegionUpdate(regionId, updates)` — updates now
  accept partial `positionRoles`/`pivotSegments`.
- Pass the region's cell labels (from workbook + headerAxis) into
  `RoleStrip` so the chips show the actual header text.

### `file-upload-workflow.util.ts`

`PLAN_MIRROR_KEYS` gets extended so `onRegionUpdate` with
`positionRoles`/`pivotSegments` mirrors into `state.plan` the same
way binding edits do today.

## Validation

`region-editor-validation.util.ts` extends `validateRegion` with:

- A segmented region's `pivotSegments` must be non-empty when
  `positionRoles` contains any `pivotLabel` role.
- Every segment must have non-empty `axisName` and
  `valueFieldName`.
- No two segments on the same region may share an `axisName`
  (collision warning — records would overwrite on merge).
- Every position with `kind: "pivotLabel"` references a defined
  segment id.

Errors render inline under each affected chip (for position-level
errors) and on the `SegmentManagementCard` (for segment-level
errors).

## Storybook

New stories under
`apps/web/src/modules/RegionEditor/stories/`:

- `RoleStrip.stories.tsx` — renders each non-trivial matrix id
  (1c, 1d, 1e, 1f, 2e, 3b, 4b) with the right `labels`/`roles`
  shape. `Interactive` story lets you toggle roles and see
  callbacks fire.
- `SegmentManagementCard.stories.tsx` — empty-state, valid,
  missing-axis-name, missing-value-field, collision-warning.

## Acceptance criteria

- After interpret, a segmented region's role strip renders along
  the correct axis (horizontal for `headerAxis:row`, vertical for
  `headerAxis:column`). Chips show actual header cell labels.
- Toggling a chip between Field / Pivot / Skip fires
  `onRolesChange` with a new `positionRoles` array containing the
  edit. Workflow state updates both `state.regions` and
  `state.plan`.
- Creating a new segment assigns the selected positions to its
  `segmentId`; the SegmentManagementCard for that segment appears.
- Renaming a segment's `axisName` or `valueFieldName` updates all
  dependent displays. `axisNameSource` flips to `"user"` on
  edit.
- Deleting a segment reassigns its positions back to
  `kind: "field"` with a confirmation prompt (no orphan positions
  left).
- Commit is blocked when validation errors exist (blocker severity
  mirrors today's blocker-gate).
- Legacy (non-segmented) plans render exactly as today — the role
  strip hides and `recordsAxisName` shows.

## Test plan

### Pure UI tests

- `RoleStrip.test.tsx` — rendering for each matrix id; multi-select
  → "Group as segment" → `onCreateSegment` fires; click chip →
  popover opens; role change fires `onRolesChange`.
- `SegmentManagementCard.test.tsx` — field renders; rename fires
  with `source: "user"`; delete prompts confirm; validation errors
  surface inline.
- `RegionConfigurationPanel.test.tsx` — role strip visible when
  region is non-crosstab with headerAxis; hidden otherwise.
  `recordsAxisName` editor hidden when segmentation is applied.

### Container tests

- `FileUploadConnectorWorkflow.test.tsx` — interpret call sends
  `enableSegmentation: true` on every region hint; response
  containing `positionRoles`/`pivotSegments` drives the panel into
  segmented mode.
- Edit flow: user changes a position from Pivot → Field and hits
  Apply; workflow's `state.plan` receives the updated
  `positionRoles`.

### Storybook smoke

- Visual parity check for each matrix id story. No functional
  regressions in existing RegionEditor stories.

## Non-goals

- Auto-segment detection is the interpret pipeline's job — the UI
  only renders and edits what the plan carries.
- Crosstab segmentation — the role strip is hidden for
  `cells-as-records`.
- Value-field-name LLM recommendation — the textbox accepts manual
  input; the heuristic pre-fills a default (`${axisName}Total`).
- Visual preview of the expanded record list — a stretch goal,
  deferred to a follow-up so the initial UI ships on its own
  scope.

## Rollout

One PR covering the two new components + panel/container/util
changes + tests + stories. Flag `enableSegmentation: true` at the
container level defaults on; this is the flip-to-default for the
opt-in introduced in the interpret spec, so the order of shipping
is: schema/replay → interpret (opt-in off) → UI (flips opt-in on).

If UI QA finds any regressions for legacy single-segment regions,
the container can revert to `enableSegmentation: false` without a
schema or interpret rollback.
