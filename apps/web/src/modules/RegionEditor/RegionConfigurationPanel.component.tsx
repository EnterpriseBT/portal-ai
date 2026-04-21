import React, { useEffect, useMemo, useState } from "react";
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

import { CellPositionInputUI } from "./CellPositionInput.component";
import { FieldNameEditorUI } from "./FieldNameEditor.component";
import { NewEntityDialogUI } from "./NewEntityDialog.component";
import { SectionHelpUI } from "./SectionHelp.component";
import { SkipAndTerminatorEditorUI } from "./SkipAndTerminatorEditor.component";
import { ToggleRowUI } from "./ToggleRow.component";
import { formatBounds } from "./utils/a1-notation.util";
import {
  colorForEntity,
  confidenceBand,
  CONFIDENCE_BAND_COLOR,
} from "./utils/region-editor-colors.util";
import {
  DECORATION_COLOR,
  DECORATION_LABEL,
  anchorCellValue,
  type DecorationKind,
} from "./utils/region-editor-decorations.util";
import {
  type BoundsMode,
  type EntityOption,
  type RegionDraft,
  type SheetPreview,
} from "./utils/region-editor.types";
import {
  orientationArrow,
  orientationArrowLabel,
} from "./utils/region-orientation.util";

export interface RegionConfigurationPanelUIProps {
  region: RegionDraft | null;
  /**
   * The sheet the region is drawn on. When provided, a pivoted region with a
   * non-blank string at its axis-anchor cell auto-populates `recordsAxisName`
   * with `source: "anchor-cell"` so the user doesn't have to retype it.
   */
  sheet?: SheetPreview;
  entityOptions: EntityOption[];
  entityOrder: string[];
  siblingsInSameEntity: number;
  errors?: import("./utils/region-editor-validation.util").RegionErrors;
  onUpdate: (updates: Partial<RegionDraft>) => void;
  onDelete: () => void;
  onSuggestAxisName?: () => void;
  onAcceptProposedIdentity?: () => void;
  onKeepPriorIdentity?: () => void;
  driftProposedIdentityLabel?: string;
  /**
   * When provided, the panel exposes a "Create new entity" affordance. The
   * callback receives a user-chosen key + label and must return the value the
   * panel should write back into `region.targetEntityDefinitionId` (typically
   * the key itself). The consuming workflow is responsible for staging the
   * entity in its local state and making it available via `entityOptions`.
   */
  onCreateEntity?: (key: string, label: string) => string;
}

const SECTION_HEADING_SX = {
  fontWeight: 600,
  textTransform: "uppercase",
  color: "text.secondary",
} as const;

export const RegionConfigurationPanelUI: React.FC<
  RegionConfigurationPanelUIProps
> = ({
  region,
  sheet,
  entityOptions,
  entityOrder,
  siblingsInSameEntity,
  errors = {},
  onUpdate,
  onDelete,
  onSuggestAxisName,
  onAcceptProposedIdentity,
  onKeepPriorIdentity,
  driftProposedIdentityLabel,
  onCreateEntity,
}) => {
  const [newEntityDialogOpen, setNewEntityDialogOpen] = useState(false);

  const selectOptions = useMemo<SelectOption[]>(
    () => buildSelectOptions(entityOptions),
    [entityOptions]
  );
  const existingKeys = useMemo(
    () => entityOptions.map((o) => o.value),
    [entityOptions]
  );

  // Auto-propose `recordsAxisName` from the anchor cell when:
  //   - the region is pivoted, AND
  //   - the user hasn't supplied a name (or an existing `anchor-cell` source is
  //     now stale because the anchor cell changed), AND
  //   - the anchor cell has a non-blank string value.
  // Keeps `source: "user"` / `source: "ai"` names untouched — users stay in control.
  const proposedFromAnchor =
    region && sheet ? anchorCellValue(region, sheet) : null;
  const regionIsPivoted =
    !!region &&
    (region.orientation === "cells-as-records" ||
      (region.orientation === "columns-as-records" &&
        region.headerAxis === "row") ||
      (region.orientation === "rows-as-records" &&
        region.headerAxis === "column"));
  const existingAxisName = region?.recordsAxisName;
  useEffect(() => {
    if (!region || !regionIsPivoted || !proposedFromAnchor) return;
    const current = existingAxisName;
    if (!current) {
      onUpdate({
        recordsAxisName: { name: proposedFromAnchor, source: "anchor-cell" },
      });
    } else if (
      current.source === "anchor-cell" &&
      current.name !== proposedFromAnchor
    ) {
      onUpdate({
        recordsAxisName: { name: proposedFromAnchor, source: "anchor-cell" },
      });
    }
  }, [region, regionIsPivoted, proposedFromAnchor, existingAxisName, onUpdate]);

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

  const crosstab = region.orientation === "cells-as-records";
  const headerless = region.headerAxis === "none";
  const legendKinds = deriveLegendKinds(region);
  const pivoted =
    crosstab ||
    (region.orientation === "columns-as-records" &&
      region.headerAxis === "row") ||
    (region.orientation === "rows-as-records" &&
      region.headerAxis === "column");
  const needsAxisName = pivoted && !region.recordsAxisName?.name;
  const needsSecondaryAxisName =
    crosstab && !region.secondaryRecordsAxisName?.name;
  const needsCellValueName = crosstab && !region.cellValueName?.name;
  const color = colorForEntity(region.targetEntityDefinitionId, entityOrder);
  const band = confidenceBand(region.confidence);
  const driftFlagged = Boolean(region.drift?.flagged);

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
            aria-label={orientationArrowLabel(region.orientation)}
            title={orientationArrowLabel(region.orientation)}
            sx={{ display: "inline-block", fontWeight: 700, mr: 0.5 }}
          >
            {orientationArrow(region.orientation)}
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

        <Stack spacing={1}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="caption" sx={SECTION_HEADING_SX}>
              Orientation
            </Typography>
            <SectionHelpUI
              ariaLabel="What is orientation?"
              title={
                <>
                  <strong>Rows:</strong> each row is a record — the most common
                  table shape.
                  <br />
                  <strong>Columns:</strong> each column is a record — use when
                  the data is pivoted sideways (field names down the left).
                  <br />
                  <strong>Cells (crosstab):</strong> every cell in the region is
                  a record, indexed by its row and column label (e.g. revenue by
                  month × region).
                </>
              }
            />
          </Stack>
          <ToggleRowUI
            value={region.orientation}
            onChange={(v) => onUpdate({ orientation: v })}
            options={[
              { value: "rows-as-records", label: "Rows" },
              { value: "columns-as-records", label: "Columns" },
              { value: "cells-as-records", label: "Cells (crosstab)" },
            ]}
          />
        </Stack>

        {!crosstab && (
          <Stack spacing={1}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography variant="caption" sx={SECTION_HEADING_SX}>
                Header axis
              </Typography>
              <SectionHelpUI
                ariaLabel="What is the header axis?"
                title={
                  <>
                    <strong>Row:</strong> the top row of the region holds the
                    field names (headers along the top).
                    <br />
                    <strong>Column:</strong> the left-most column of the region
                    holds the field names (headers down the left).
                    <br />
                    <strong>None:</strong> the region has no header — field
                    names are auto-generated from position and can be overridden
                    below.
                  </>
                }
              />
            </Stack>
            <ToggleRowUI
              value={region.headerAxis}
              onChange={(v) => onUpdate({ headerAxis: v })}
              options={[
                { value: "row", label: "Row" },
                { value: "column", label: "Column" },
                { value: "none", label: "None" },
              ]}
            />
            {region.headerAxis !== "none" && (
              <Typography variant="caption" color="text.secondary">
                Blank rows between headers and data are skipped automatically.
              </Typography>
            )}
          </Stack>
        )}

        {headerless && !crosstab && (
          <Stack spacing={1}>
            <Typography variant="caption" sx={SECTION_HEADING_SX}>
              Field names
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Auto-generated from position. Override any name below.
            </Typography>
            <FieldNameEditorUI region={region} onUpdate={onUpdate} />
          </Stack>
        )}

        {pivoted && (
          <Stack spacing={1}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography variant="caption" sx={SECTION_HEADING_SX}>
                {crosstab ? "Row-axis name" : "Records-axis name"}
              </Typography>
              <SectionHelpUI
                ariaLabel={
                  crosstab
                    ? "What is the row-axis name?"
                    : "What is the records-axis name?"
                }
                title={
                  crosstab ? (
                    <>
                      Name the dimension whose <em>values</em> run down the rows
                      of the crosstab (e.g. <em>Month</em> when months label the
                      rows). It becomes a field on every extracted record.
                    </>
                  ) : (
                    <>
                      When a region is pivoted (field names run along the header
                      axis rather than the record axis), the record-axis labels
                      themselves become the values of a field — this name labels
                      that field. For example, if each column is a record and
                      years label the columns, the records-axis name might be{" "}
                      <em>Year</em>.
                    </>
                  )
                }
              />
            </Stack>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <TextInput
                size="small"
                fullWidth
                value={region.recordsAxisName?.name ?? ""}
                onChange={(e) =>
                  onUpdate({
                    recordsAxisName: e.target.value
                      ? { name: e.target.value, source: "user" }
                      : undefined,
                  })
                }
                placeholder={
                  crosstab ? "e.g. Quarter, Region" : "e.g. Month, Region, Year"
                }
                required
                error={needsAxisName}
                helperText={
                  needsAxisName
                    ? crosstab
                      ? "Required — names the row dimension"
                      : "Required for pivoted regions"
                    : undefined
                }
                slotProps={{ htmlInput: { "aria-invalid": needsAxisName } }}
              />
              {onSuggestAxisName && !region.recordsAxisName?.name && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={onSuggestAxisName}
                >
                  Suggest
                </Button>
              )}
            </Stack>
            {region.recordsAxisName?.source === "ai" && (
              <Typography variant="caption" sx={{ color: "warning.dark" }}>
                AI suggestion — confirm before continuing.
              </Typography>
            )}
            {region.recordsAxisName?.source === "anchor-cell" && (
              <Typography variant="caption" color="text.secondary">
                Read from anchor cell — edit to override.
              </Typography>
            )}
          </Stack>
        )}

        {crosstab && (
          <Stack spacing={1}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography variant="caption" sx={SECTION_HEADING_SX}>
                Column-axis name
              </Typography>
              <SectionHelpUI
                ariaLabel="What is the column-axis name?"
                title={
                  <>
                    Name the dimension whose <em>values</em> run across the
                    columns of the crosstab (e.g. <em>Region</em> when regions
                    label the columns). It becomes a field on every extracted
                    record.
                  </>
                }
              />
            </Stack>
            <TextInput
              size="small"
              fullWidth
              value={region.secondaryRecordsAxisName?.name ?? ""}
              onChange={(e) =>
                onUpdate({
                  secondaryRecordsAxisName: e.target.value
                    ? { name: e.target.value, source: "user" }
                    : undefined,
                })
              }
              placeholder="e.g. Month, Category"
              required
              error={needsSecondaryAxisName}
              helperText={
                needsSecondaryAxisName
                  ? "Required — names the column dimension"
                  : undefined
              }
              slotProps={{
                htmlInput: { "aria-invalid": needsSecondaryAxisName },
              }}
            />
          </Stack>
        )}

        {crosstab && (
          <Stack spacing={1}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography variant="caption" sx={SECTION_HEADING_SX}>
                Cell value name
              </Typography>
              <SectionHelpUI
                ariaLabel="What is the cell value name?"
                title={
                  <>
                    Name the field that holds each cell&apos;s <em>value</em> in
                    the crosstab (e.g. <em>Revenue</em> when cells contain
                    dollar amounts). Every extracted record has this field
                    alongside the row- and column-axis fields.
                  </>
                }
              />
            </Stack>
            <TextInput
              size="small"
              fullWidth
              value={region.cellValueName?.name ?? ""}
              onChange={(e) =>
                onUpdate({
                  cellValueName: e.target.value
                    ? { name: e.target.value, source: "user" }
                    : undefined,
                })
              }
              placeholder="e.g. Revenue, Headcount, Amount"
              required
              error={needsCellValueName}
              helperText={
                needsCellValueName
                  ? "Required — names the field that holds each cell's value"
                  : `Each extracted record will have fields: ${region.recordsAxisName?.name ?? "<row axis>"} · ${region.secondaryRecordsAxisName?.name ?? "<col axis>"} · ${region.cellValueName?.name ?? "<cell value>"}`
              }
              slotProps={{ htmlInput: { "aria-invalid": needsCellValueName } }}
            />
          </Stack>
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

        <Stack spacing={1}>
          <Typography variant="caption" sx={SECTION_HEADING_SX}>
            Extent
          </Typography>
          <ToggleRowUI<BoundsMode>
            value={region.boundsMode ?? "absolute"}
            onChange={(v) =>
              onUpdate({
                boundsMode: v,
                boundsPattern:
                  v === "matchesPattern"
                    ? (region.boundsPattern ?? "")
                    : undefined,
              })
            }
            options={[
              { value: "absolute", label: "Fixed" },
              { value: "untilEmpty", label: "Until empty" },
              { value: "matchesPattern", label: "Matches pattern" },
            ]}
          />
          <Typography variant="caption" color="text.secondary">
            {extentDescription(
              region.orientation,
              region.boundsMode ?? "absolute"
            )}
          </Typography>
          {region.boundsMode === "matchesPattern" && (
            <TextInput
              size="small"
              fullWidth
              value={region.boundsPattern ?? ""}
              onChange={(e) => onUpdate({ boundsPattern: e.target.value })}
              placeholder="Regex or literal (e.g. ^Total$)"
              label="Stop pattern"
              required
              error={Boolean(errors.boundsPattern)}
              helperText={
                errors.boundsPattern ??
                "Region ends at the first record matching this pattern."
              }
              slotProps={{
                htmlInput: { "aria-invalid": Boolean(errors.boundsPattern) },
              }}
            />
          )}
        </Stack>

        <SkipAndTerminatorEditorUI
          region={region}
          onUpdate={onUpdate}
          errors={errors}
        />
      </Stack>

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

function buildSelectOptions(options: EntityOption[]): SelectOption[] {
  return options.map((o) => ({
    value: o.value,
    label: o.source === "staged" ? `${o.label} — new` : o.label,
  }));
}

function deriveLegendKinds(region: RegionDraft): DecorationKind[] {
  const kinds: DecorationKind[] = [];
  if (
    region.orientation !== "cells-as-records" &&
    (region.headerAxis === "row" || region.headerAxis === "column")
  ) {
    kinds.push("header");
  }
  if (region.orientation === "cells-as-records") {
    kinds.push("rowAxisLabel", "colAxisLabel");
  }
  if (region.skipRules && region.skipRules.length > 0) {
    kinds.push("skipped");
  }
  return kinds;
}

function extentDescription(
  orientation: RegionDraft["orientation"],
  mode: BoundsMode
): string {
  const axis = orientation === "rows-as-records" ? "row" : "column";
  switch (mode) {
    case "absolute":
      return "Region ends at the drawn bounds.";
    case "untilEmpty":
      return `Region extends until the first completely empty ${axis}.`;
    case "matchesPattern":
      return `Region stops at the first ${axis} whose identity cell matches the stop pattern. That record and everything after it is excluded.`;
  }
}
