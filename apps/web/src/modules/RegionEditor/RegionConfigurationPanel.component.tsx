import React, { useMemo, useState } from "react";
import {
  Box,
  Stack,
  Typography,
  TextInput,
  Select,
  Button,
  IconButton,
  Divider,
} from "@portalai/core/ui";
import { IconName } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import type {
  AxisMember,
  CellValueField,
  Segment,
  Terminator,
} from "@portalai/core/contracts";

import { CellPositionInputUI } from "./CellPositionInput.component";
import { NewEntityDialogUI } from "./NewEntityDialog.component";
import { RecordAxisTerminatorPopoverUI } from "./RecordAxisTerminatorPopover.component";
import { SectionHelpUI } from "./SectionHelp.component";
import { SegmentEditPopoverUI } from "./SegmentEditPopover.component";
import { SegmentStripUI } from "./SegmentStrip.component";
import { SkipAndTerminatorEditorUI } from "./SkipAndTerminatorEditor.component";
import { formatBounds } from "./utils/a1-notation.util";
import {
  colorForEntity,
  confidenceBand,
  CONFIDENCE_BAND_COLOR,
} from "./utils/region-editor-colors.util";
import {
  DECORATION_COLOR,
  DECORATION_LABEL,
  type DecorationKind,
} from "./utils/region-editor-decorations.util";
import type {
  EntityOption,
  RegionDraft,
  SheetPreview,
} from "./utils/region-editor.types";
import {
  isDraftCrosstab,
  isDraftPivoted,
  orientationArrow,
  orientationArrowLabel,
  orientationFromDraft,
} from "./utils/region-orientation.util";

export interface RegionConfigurationPanelUIProps {
  region: RegionDraft | null;
  /**
   * The sheet the region is drawn on. Retained from the pre-PR-4 panel for
   * downstream consumers that still pass it; the panel no longer reads it
   * (anchor-cell axis-name auto-fill moves to the workflow in PR-5).
   */
  sheet?: SheetPreview;
  entityOptions: EntityOption[];
  entityOrder: string[];
  siblingsInSameEntity: number;
  errors?: import("./utils/region-editor-validation.util").RegionErrors;
  onUpdate: (updates: Partial<RegionDraft>) => void;
  onDelete: () => void;
  /**
   * Retained for workflow-level callers; the PR-4 panel no longer exposes a
   * "Suggest axis name" button at the region level — suggestion moves to
   * the per-segment popover in a follow-up. Passing this prop is a no-op
   * for now and its presence does not surface any affordance.
   */
  onSuggestAxisName?: () => void;
  onAcceptProposedIdentity?: () => void;
  onKeepPriorIdentity?: () => void;
  driftProposedIdentityLabel?: string;
  onCreateEntity?: (key: string, label: string) => string;
  claimedEntityKeys?: Set<string>;
  validateEntityKey?: (
    key: string
  ) => Promise<{ ok: true } | { ok: false; ownedBy?: string }>;
}

const SECTION_HEADING_SX = {
  fontWeight: 600,
  textTransform: "uppercase",
  color: "text.secondary",
} as const;

type EditingSegment = { axis: AxisMember; index: number };

// ── Pure segment manipulation on the draft ───────────────────────────────

function axisSegments(region: RegionDraft, axis: AxisMember): Segment[] {
  return region.segmentsByAxis?.[axis] ?? [];
}

function axisSpan(region: RegionDraft, axis: AxisMember): number {
  const { startRow, startCol, endRow, endCol } = region.bounds;
  return axis === "row" ? endCol - startCol + 1 : endRow - startRow + 1;
}

function writeSegments(
  region: RegionDraft,
  axis: AxisMember,
  segments: Segment[]
): Partial<RegionDraft> {
  return {
    segmentsByAxis: { ...(region.segmentsByAxis ?? {}), [axis]: segments },
  };
}

function hasAnyPivot(region: RegionDraft): boolean {
  for (const axis of ["row", "column"] as const) {
    if (axisSegments(region, axis).some((s) => s.kind === "pivot")) return true;
  }
  return false;
}

function withPivotSync(
  region: RegionDraft,
  updates: Partial<RegionDraft>
): Partial<RegionDraft> {
  const projected: RegionDraft = { ...region, ...updates };
  const pivot = hasAnyPivot(projected);
  if (pivot && !projected.cellValueField) {
    return { ...updates, cellValueField: { name: "value", nameSource: "user" } };
  }
  if (!pivot && projected.cellValueField) {
    return { ...updates, cellValueField: undefined };
  }
  return updates;
}

function defaultTerminator(): Terminator {
  return { kind: "untilBlank", consecutiveBlanks: 2 };
}

// ── Component ────────────────────────────────────────────────────────────

export const RegionConfigurationPanelUI: React.FC<
  RegionConfigurationPanelUIProps
> = ({
  region,
  entityOptions,
  entityOrder,
  siblingsInSameEntity,
  errors = {},
  onUpdate,
  onDelete,
  onAcceptProposedIdentity,
  onKeepPriorIdentity,
  driftProposedIdentityLabel,
  onCreateEntity,
  claimedEntityKeys,
  validateEntityKey,
}) => {
  const [newEntityDialogOpen, setNewEntityDialogOpen] = useState(false);
  const [editingSegment, setEditingSegment] =
    useState<EditingSegment | null>(null);
  const [segmentAnchor, setSegmentAnchor] = useState<HTMLElement | null>(null);
  const [extentOpen, setExtentOpen] = useState(false);
  const [extentAnchor, setExtentAnchor] = useState<HTMLElement | null>(null);

  const currentTarget = region?.targetEntityDefinitionId ?? null;
  const selectOptions = useMemo<SelectOption[]>(
    () => buildSelectOptions(entityOptions, claimedEntityKeys, currentTarget),
    [entityOptions, claimedEntityKeys, currentTarget]
  );
  const existingKeys = useMemo(
    () => entityOptions.map((o) => o.value),
    [entityOptions]
  );

  if (!region) {
    return (
      <Stack
        spacing={1}
        sx={{
          width: "100%",
          minWidth: 0,
          p: 2,
          border: "1px dashed",
          borderColor: "divider",
          borderRadius: 1,
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Draw a region on the canvas, or select an existing region, to
          configure it here.
        </Typography>
      </Stack>
    );
  }

  const orientation = orientationFromDraft(region);
  const crosstab = isDraftCrosstab(region);
  const pivoted = isDraftPivoted(region);
  const legendKinds = deriveLegendKinds(region, crosstab);
  const headerAxes = region.headerAxes ?? [];
  const canAddSecondAxis = headerAxes.length === 1;
  const color = colorForEntity(region.targetEntityDefinitionId, entityOrder);
  const band = confidenceBand(region.confidence);
  const driftFlagged = Boolean(region.drift?.flagged);

  const editingAxis = editingSegment?.axis;
  const editingSeg: Segment | null =
    editingSegment
      ? (axisSegments(region, editingSegment.axis)[editingSegment.index] ?? null)
      : null;
  const editingIsTail = editingSegment
    ? editingSegment.index === axisSegments(region, editingSegment.axis).length - 1
    : false;

  const closeSegmentEditor = () => {
    setEditingSegment(null);
    setSegmentAnchor(null);
  };

  const handleEditSegment = (
    axis: AxisMember,
    index: number,
    anchor: HTMLElement
  ) => {
    setSegmentAnchor(anchor);
    setEditingSegment({ axis, index });
  };

  const handleAddSegment = (axis: AxisMember) => {
    const segments = [...axisSegments(region, axis)];
    const positionCount = 1;
    segments.push({ kind: "field", positionCount });
    const merged = coalesceSegments(segments);
    const span = axisSpan(region, axis);
    onUpdate({
      ...writeSegments(region, axis, merged),
      bounds: expandBoundsAlongAxis(region.bounds, axis, span + positionCount),
    });
  };

  const handleAddHeaderAxis = (otherAxis: AxisMember) => {
    if (headerAxes.includes(otherAxis)) return;
    const span = axisSpan(region, otherAxis);
    const nextAxes: AxisMember[] = [...headerAxes, otherAxis];
    onUpdate({
      headerAxes: nextAxes,
      segmentsByAxis: {
        ...(region.segmentsByAxis ?? {}),
        [otherAxis]: [{ kind: "skip", positionCount: span }],
      },
    });
  };

  const handleRemoveHeaderAxis = (axis: AxisMember) => {
    if (!headerAxes.includes(axis) || headerAxes.length < 2) return;
    const nextAxes = headerAxes.filter((a) => a !== axis);
    const nextSegs = { ...(region.segmentsByAxis ?? {}) };
    delete nextSegs[axis];
    const updates = withPivotSync(
      { ...region, headerAxes: nextAxes, segmentsByAxis: nextSegs },
      { headerAxes: nextAxes, segmentsByAxis: nextSegs }
    );
    onUpdate(updates);
  };

  const handleConvertSegment = (toKind: Segment["kind"]) => {
    if (!editingSegment) return;
    const { axis, index } = editingSegment;
    const segments = [...axisSegments(region, axis)];
    const seg = segments[index];
    if (!seg) return;
    let replacement: Segment;
    if (toKind === "field") {
      replacement = { kind: "field", positionCount: seg.positionCount };
    } else if (toKind === "skip") {
      replacement = { kind: "skip", positionCount: seg.positionCount };
    } else {
      const existingName = seg.kind === "pivot" ? seg.axisName : "";
      replacement = {
        kind: "pivot",
        id: seg.kind === "pivot" ? seg.id : mintPivotId(region),
        axisName: existingName,
        axisNameSource: seg.kind === "pivot" ? seg.axisNameSource : "user",
        positionCount: seg.positionCount,
      };
    }
    segments[index] = replacement;
    const merged = coalesceSegments(segments);
    const updates = withPivotSync(region, writeSegments(region, axis, merged));
    onUpdate(updates);
  };

  const handleChangeAxisName = (value: string) => {
    if (!editingSegment) return;
    const { axis, index } = editingSegment;
    const segments = [...axisSegments(region, axis)];
    const seg = segments[index];
    if (seg?.kind !== "pivot") return;
    segments[index] = { ...seg, axisName: value, axisNameSource: "user" };
    onUpdate(writeSegments(region, axis, segments));
  };

  const handleToggleDynamic = (on: boolean) => {
    if (!editingSegment) return;
    const { axis, index } = editingSegment;
    const segments = [...axisSegments(region, axis)];
    const seg = segments[index];
    if (seg?.kind !== "pivot") return;
    if (on) {
      segments[index] = { ...seg, dynamic: { terminator: defaultTerminator() } };
    } else {
      const { dynamic: _drop, ...rest } = seg;
      segments[index] = rest;
    }
    onUpdate(writeSegments(region, axis, segments));
  };

  const handleChangeSegmentTerminator = (terminator: Terminator) => {
    if (!editingSegment) return;
    const { axis, index } = editingSegment;
    const segments = [...axisSegments(region, axis)];
    const seg = segments[index];
    if (seg?.kind !== "pivot") return;
    segments[index] = { ...seg, dynamic: { terminator } };
    onUpdate(writeSegments(region, axis, segments));
  };

  const handleChangeCellValueFieldName = (value: string) => {
    const current: CellValueField = region.cellValueField ?? {
      name: "",
      nameSource: "user",
    };
    onUpdate({
      cellValueField: { ...current, name: value, nameSource: "user" },
    });
  };

  const handleToggleExtent = (on: boolean) => {
    onUpdate({
      recordAxisTerminator: on ? defaultTerminator() : undefined,
    });
  };

  const handleChangeRecordAxisTerminator = (terminator: Terminator) => {
    onUpdate({ recordAxisTerminator: terminator });
  };

  return (
    <Box
      sx={{
        width: "100%",
        minWidth: 0,
        p: 2,
        border: "1px solid",
        borderColor: driftFlagged ? "warning.main" : "divider",
        borderRadius: 1,
        backgroundColor: "background.paper",
        display: "grid",
        rowGap: 2,
        columnGap: 3,
        gridTemplateColumns: {
          xs: "minmax(0, 1fr)",
          sm: "minmax(0, 1fr) auto minmax(0, 1fr)",
          lg: "minmax(0, 1fr)",
        },
      }}
    >
      <Stack spacing={1} sx={{ gridColumn: "1 / -1" }}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ minWidth: 0 }}
        >
          <Box
            sx={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              backgroundColor: color,
              flexShrink: 0,
            }}
          />
          <Typography
            variant="subtitle2"
            sx={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={
              region.proposedLabel ?? region.targetEntityLabel ?? "New region"
            }
          >
            {region.proposedLabel ?? region.targetEntityLabel ?? "New region"}
          </Typography>
          <IconButton
            aria-label="Delete region"
            size="small"
            onClick={onDelete}
            icon={IconName.Delete}
          />
        </Stack>

        <Typography variant="caption" color="text.secondary">
          <Box
            component="span"
            aria-label={orientationArrowLabel(orientation)}
            title={orientationArrowLabel(orientation)}
            sx={{ display: "inline-block", fontWeight: 700, mr: 0.5 }}
          >
            {orientationArrow(orientation)}
          </Box>
          {formatBounds(region.bounds)} ·{" "}
          {region.bounds.endRow - region.bounds.startRow + 1} rows ·{" "}
          {region.bounds.endCol - region.bounds.startCol + 1} cols
        </Typography>

        {legendKinds.length > 0 && (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
            sx={{ mt: -0.5 }}
          >
            {legendKinds.map((kind) => (
              <Stack
                key={kind}
                direction="row"
                spacing={0.5}
                alignItems="center"
                sx={{ minWidth: 0 }}
              >
                <Box
                  sx={{
                    width: 12,
                    height: 12,
                    backgroundColor: DECORATION_COLOR[kind],
                    borderRadius: 0.5,
                    border: "1px solid",
                    borderColor: "divider",
                    flexShrink: 0,
                    backgroundImage:
                      kind === "skipped"
                        ? "repeating-linear-gradient(45deg, rgba(100,116,139,0.45) 0 3px, transparent 3px 6px)"
                        : undefined,
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  {DECORATION_LABEL[kind]}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}

        {driftFlagged && (
          <Box
            sx={{
              p: 1.5,
              borderRadius: 1,
              backgroundColor: "warning.lighter",
              border: "1px solid",
              borderColor: "warning.main",
            }}
          >
            <Typography
              variant="subtitle2"
              color="warning.dark"
              sx={{ mb: 0.5 }}
            >
              Drift detected{" "}
              {region.drift?.identityChanging ? "— identity changing" : ""}
            </Typography>
            {region.drift?.priorSummary && (
              <Typography variant="caption" sx={{ display: "block" }}>
                <strong>Prior:</strong> {region.drift.priorSummary}
              </Typography>
            )}
            {region.drift?.observedSummary && (
              <Typography variant="caption" sx={{ display: "block" }}>
                <strong>Observed:</strong> {region.drift.observedSummary}
              </Typography>
            )}
            {region.drift?.identityChanging && (
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button
                  size="small"
                  variant="contained"
                  onClick={onAcceptProposedIdentity}
                >
                  Accept {driftProposedIdentityLabel ?? "new identity"}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={onKeepPriorIdentity}
                >
                  Keep prior
                </Button>
              </Stack>
            )}
          </Box>
        )}
      </Stack>

      <Stack
        spacing={2}
        sx={{
          gridColumn: "1 / -1",
          width: "100%",
        }}
      >
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Typography variant="caption" sx={SECTION_HEADING_SX}>
            Identity
          </Typography>
          <SectionHelpUI
            ariaLabel="What is the target entity?"
            title={
              <>
                <strong>Target entity</strong> is the record type this region
                produces — one row (or crosstab cell) per record inside that
                entity.
                <br />
                <br />
                <strong>Multiple regions → same entity.</strong> Point two or
                more regions at the same target when a single entity&rsquo;s
                records are split across sheets or laid out in different shapes.
                Their bindings merge and become a single set of field mappings.
                <br />
                <br />
                <strong>Multiple regions from the same sheet.</strong> One sheet
                can hold several regions, each pointing at a different target
                entity — useful when a sheet mixes a header block with one or
                more data tables, or stacks two distinct tables vertically.
              </>
            }
          />
        </Stack>

        <Stack
          direction={{ xs: "column", sm: "row", lg: "column" }}
          spacing={1}
          alignItems="center"
          sx={{ width: "100%", minWidth: 0 }}
        >
          <TextInput
            label="Label"
            size="small"
            fullWidth
            value={region.proposedLabel ?? ""}
            onChange={(e) => onUpdate({ proposedLabel: e.target.value })}
            placeholder="Optional region label"
            sx={{ flex: 1, minWidth: 0 }}
          />

          <Stack
            spacing={0.5}
            sx={{
              flex: 1,
              minWidth: 0,
              width: "100%",
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <Select
              label="Target entity"
              size="small"
              fullWidth
              required
              error={Boolean(errors.targetEntityDefinitionId)}
              helperText={errors.targetEntityDefinitionId}
              value={region.targetEntityDefinitionId ?? ""}
              onChange={(e) => {
                const id = (e.target.value as string) || null;
                const option = entityOptions.find((o) => o.value === id);
                onUpdate({
                  targetEntityDefinitionId: id,
                  targetEntityLabel: option?.label,
                });
              }}
              options={selectOptions}
              placeholder="Select entity…"
              slotProps={{
                htmlInput: {
                  "aria-invalid": Boolean(errors.targetEntityDefinitionId),
                },
              }}
            />
            {onCreateEntity && (
              <Button
                size="small"
                variant="text"
                onClick={() => setNewEntityDialogOpen(true)}
                sx={{ textTransform: "none" }}
              >
                + Create new entity
              </Button>
            )}
          </Stack>
        </Stack>

        {siblingsInSameEntity > 0 && region.targetEntityDefinitionId && (
          <Typography variant="caption" color="text.secondary">
            Merges into entity with {siblingsInSameEntity} other{" "}
            {siblingsInSameEntity === 1 ? "region" : "regions"}. AI field
            mapping runs once across all merged regions.
          </Typography>
        )}
      </Stack>

      {onCreateEntity && (
        <NewEntityDialogUI
          open={newEntityDialogOpen}
          onClose={() => setNewEntityDialogOpen(false)}
          existingKeys={existingKeys}
          initialLabel={region.proposedLabel ?? ""}
          validateKey={validateEntityKey}
          onSubmit={(key, label) => {
            const nextValue = onCreateEntity(key, label);
            onUpdate({
              targetEntityDefinitionId: nextValue,
              targetEntityLabel: label,
            });
          }}
        />
      )}

      <Divider sx={{ gridColumn: "1 / -1" }} />

      <Stack spacing={2}>
        <Typography variant="caption" sx={SECTION_HEADING_SX}>
          Shape
        </Typography>

        {headerAxes.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            This region has no header axis. Field names are derived from
            position — the Review step surfaces per-field overrides.
          </Typography>
        )}

        {headerAxes.includes("row") && (
          <SegmentStripUI
            axis="row"
            segments={axisSegments(region, "row")}
            axisLabel="Row axis"
            onEditSegment={handleEditSegment}
            onAddSegment={handleAddSegment}
            onAddHeaderAxis={
              canAddSecondAxis && !headerAxes.includes("column")
                ? handleAddHeaderAxis
                : undefined
            }
          />
        )}

        {headerAxes.includes("column") && (
          <SegmentStripUI
            axis="column"
            segments={axisSegments(region, "column")}
            axisLabel="Column axis"
            onEditSegment={handleEditSegment}
            onAddSegment={handleAddSegment}
            onAddHeaderAxis={
              canAddSecondAxis && !headerAxes.includes("row")
                ? handleAddHeaderAxis
                : undefined
            }
          />
        )}

        {crosstab && (
          <Button
            size="small"
            variant="text"
            onClick={() => handleRemoveHeaderAxis("column")}
            sx={{ alignSelf: "flex-start" }}
          >
            Collapse crosstab (remove column axis)
          </Button>
        )}

        {pivoted && (
          <TextInput
            size="small"
            fullWidth
            label="Cell-value field name"
            value={region.cellValueField?.name ?? ""}
            onChange={(e) => handleChangeCellValueFieldName(e.target.value)}
            placeholder="e.g. Revenue, Headcount, Amount"
            required
            error={Boolean(errors.cellValueField)}
            helperText={
              errors.cellValueField ??
              "Each extracted record has a field by this name holding the cell value."
            }
            slotProps={{
              htmlInput: { "aria-invalid": Boolean(errors.cellValueField) },
            }}
          />
        )}

        {pivoted && (
          <Stack spacing={1}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography variant="caption" sx={SECTION_HEADING_SX}>
                Axis-name anchor cell
              </Typography>
              <SectionHelpUI
                ariaLabel="What is the axis-name anchor cell?"
                title={
                  <>
                    The cell whose value names the unlabeled axis (or axes, for
                    a crosstab). Defaults to the top-left of the region.
                    Override it only when the axis label lives in a different
                    cell — e.g. a legend row at the bottom of the block.
                  </>
                }
              />
            </Stack>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <CellPositionInputUI
                axis="row"
                label="Row"
                index={region.axisAnchorCell?.row ?? region.bounds.startRow}
                startIndex={region.bounds.startRow}
                endIndex={region.bounds.endRow}
                onChange={(nextRow) =>
                  onUpdate({
                    axisAnchorCell: {
                      row: nextRow,
                      col: region.axisAnchorCell?.col ?? region.bounds.startCol,
                    },
                  })
                }
                error={Boolean(errors.axisAnchorCell)}
                helperText={errors.axisAnchorCell}
              />
              <CellPositionInputUI
                axis="column"
                label="Column"
                index={region.axisAnchorCell?.col ?? region.bounds.startCol}
                startIndex={region.bounds.startCol}
                endIndex={region.bounds.endCol}
                onChange={(nextCol) =>
                  onUpdate({
                    axisAnchorCell: {
                      row: region.axisAnchorCell?.row ?? region.bounds.startRow,
                      col: nextCol,
                    },
                  })
                }
                error={Boolean(errors.axisAnchorCell)}
              />
              {region.axisAnchorCell && (
                <Button
                  size="small"
                  variant="text"
                  onClick={() => onUpdate({ axisAnchorCell: undefined })}
                  sx={{ textTransform: "none" }}
                >
                  Reset to top-left
                </Button>
              )}
            </Stack>
          </Stack>
        )}
      </Stack>

      <Divider
        orientation="vertical"
        flexItem
        sx={{ display: { xs: "none", sm: "block", lg: "none" } }}
      />
      <Divider
        sx={{ gridColumn: "1 / -1", display: { xs: "none", lg: "block" } }}
      />

      <Stack spacing={2}>
        <Typography variant="caption" sx={SECTION_HEADING_SX}>
          Extent & skip rules
        </Typography>

        {!crosstab && (
          <Stack spacing={1}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography variant="caption" sx={SECTION_HEADING_SX}>
                Extent
              </Typography>
              <SectionHelpUI
                ariaLabel="What controls the region extent?"
                title={
                  <>
                    By default the region ends at the drawn bounds. Open the
                    Extent control to let the record axis grow until a
                    terminator is hit (N blanks in a row, or a cell matching
                    a pattern). Crosstabs keep fixed bounds (refinement 11).
                  </>
                }
              />
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                size="small"
                variant="outlined"
                onClick={(e) => {
                  setExtentAnchor(e.currentTarget);
                  setExtentOpen(true);
                }}
              >
                {region.recordAxisTerminator
                  ? `Extent: grows until ${
                      region.recordAxisTerminator.kind === "untilBlank"
                        ? `${region.recordAxisTerminator.consecutiveBlanks} blanks`
                        : `/${region.recordAxisTerminator.pattern}/`
                    }`
                  : "Extent: fixed bounds"}
              </Button>
            </Stack>
            <RecordAxisTerminatorPopoverUI
              open={extentOpen}
              anchorEl={extentAnchor}
              recordsAxis={
                headerAxes.length === 1
                  ? headerAxes[0] === "row"
                    ? "column"
                    : "row"
                  : region.headerAxes?.length === 0 && region.recordsAxis
                    ? region.recordsAxis
                    : "row"
              }
              terminator={region.recordAxisTerminator}
              onToggle={handleToggleExtent}
              onChangeTerminator={handleChangeRecordAxisTerminator}
              onClose={() => setExtentOpen(false)}
            />
          </Stack>
        )}

        <SkipAndTerminatorEditorUI
          region={region}
          onUpdate={onUpdate}
          errors={errors}
        />
      </Stack>

      {editingSegment && editingSeg && editingAxis !== undefined && (
        <SegmentEditPopoverUI
          open={editingSegment !== null}
          anchorEl={segmentAnchor}
          axis={editingAxis}
          segment={editingSeg}
          isTail={editingIsTail}
          onChangeAxisName={handleChangeAxisName}
          onToggleDynamic={handleToggleDynamic}
          onChangeTerminator={handleChangeSegmentTerminator}
          onConvert={handleConvertSegment}
          onClose={closeSegmentEditor}
        />
      )}

      {band !== "none" && (
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ gridColumn: "1 / -1" }}
        >
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: CONFIDENCE_BAND_COLOR[band],
            }}
          />
          <Typography variant="caption" color="text.secondary">
            Confidence:{" "}
            {region.confidence !== undefined
              ? `${Math.round(region.confidence * 100)}%`
              : "—"}
          </Typography>
        </Stack>
      )}
    </Box>
  );
};

function buildSelectOptions(
  options: EntityOption[],
  claimedEntityKeys: Set<string> | undefined,
  currentTarget: string | null
): SelectOption[] {
  return options.map((o) => ({
    value: o.value,
    label: formatEntityOptionLabel(o),
    disabled:
      claimedEntityKeys !== undefined &&
      claimedEntityKeys.has(o.value) &&
      o.value !== currentTarget,
  }));
}

function formatEntityOptionLabel(o: EntityOption): string {
  if (o.source === "staged") return `${o.label} — new`;
  if (o.connectorInstanceName) return `${o.label} — ${o.connectorInstanceName}`;
  return o.label;
}

function deriveLegendKinds(
  region: RegionDraft,
  crosstab: boolean
): DecorationKind[] {
  const kinds: DecorationKind[] = [];
  const axes = region.headerAxes ?? [];
  if (crosstab) {
    kinds.push("rowAxisLabel", "colAxisLabel");
  } else if (axes.length === 1) {
    kinds.push("header");
  }
  if (region.skipRules && region.skipRules.length > 0) {
    kinds.push("skipped");
  }
  return kinds;
}

function coalesceSegments(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    const tail = out[out.length - 1];
    if (!tail || tail.kind !== seg.kind) {
      out.push(seg);
      continue;
    }
    if (tail.kind === "field" && seg.kind === "field") {
      out[out.length - 1] = {
        kind: "field",
        positionCount: tail.positionCount + seg.positionCount,
      };
      continue;
    }
    if (tail.kind === "skip" && seg.kind === "skip") {
      out[out.length - 1] = {
        kind: "skip",
        positionCount: tail.positionCount + seg.positionCount,
      };
      continue;
    }
    out.push(seg);
  }
  return out;
}

function expandBoundsAlongAxis(
  bounds: RegionDraft["bounds"],
  axis: AxisMember,
  newSpan: number
): RegionDraft["bounds"] {
  const { startRow, startCol, endRow, endCol } = bounds;
  if (axis === "row") {
    return { startRow, startCol, endRow, endCol: startCol + newSpan - 1 };
  }
  return { startRow, startCol, endRow: startRow + newSpan - 1, endCol };
}

function mintPivotId(region: RegionDraft): string {
  const existing = new Set<string>();
  for (const axis of ["row", "column"] as const) {
    for (const s of axisSegments(region, axis)) {
      if (s.kind === "pivot") existing.add(s.id);
    }
  }
  let i = 1;
  while (existing.has(`pivot-${i}`)) i++;
  return `pivot-${i}`;
}
