import React from "react";
import {
  Box,
  Stack,
  Typography,
  TextInput,
  Select,
  Divider,
  Button,
  IconButton,
  Checkbox,
} from "@portalai/core/ui";
import { IconName } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";

import { colIndexToLetter, defaultFieldNamesForRegion, formatBounds } from "./utils/a1-notation.util";
import { colorForEntity, confidenceBand, CONFIDENCE_BAND_COLOR } from "./utils/region-editor-colors.util";
import {
  DECORATION_COLOR,
  DECORATION_LABEL,
  type DecorationKind,
} from "./utils/region-editor-decorations.util";
import {
  DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT,
  type BoundsMode,
  type RegionDraft,
  type SkipRule,
} from "./utils/region-editor.types";

export interface RegionSidePanelProps {
  region: RegionDraft | null;
  entityOptions: SelectOption[];
  entityOrder: string[];
  siblingsInSameEntity: number;
  errors?: import("./utils/region-editor-validation.util").RegionErrors;
  onUpdate: (updates: Partial<RegionDraft>) => void;
  onDelete: () => void;
  onSuggestAxisName?: () => void;
  onAcceptProposedIdentity?: () => void;
  onKeepPriorIdentity?: () => void;
  driftProposedIdentityLabel?: string;
}

export const RegionSidePanel: React.FC<RegionSidePanelProps> = ({
  region,
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
}) => {
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
          Draw a region on the canvas, or select an existing region, to configure it here.
        </Typography>
      </Stack>
    );
  }

  const crosstab = region.orientation === "cells-as-records";
  const headerless = region.headerAxis === "none";
  const legendKinds = deriveLegendKinds(region);
  const pivoted =
    crosstab ||
    (region.orientation === "columns-as-records" && region.headerAxis === "row") ||
    (region.orientation === "rows-as-records" && region.headerAxis === "column");
  const needsAxisName = pivoted && !region.recordsAxisName?.name;
  const needsSecondaryAxisName = crosstab && !region.secondaryRecordsAxisName?.name;
  const needsCellValueName = crosstab && !region.cellValueName?.name;
  const color = colorForEntity(region.targetEntityDefinitionId, entityOrder);
  const band = confidenceBand(region.confidence);
  const driftFlagged = Boolean(region.drift?.flagged);

  return (
    <Stack
      spacing={2}
      sx={{
        width: "100%",
        minWidth: 0,
        p: 2,
        border: "1px solid",
        borderColor: driftFlagged ? "warning.main" : "divider",
        borderRadius: 1,
        backgroundColor: "background.paper",
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
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
          title={region.proposedLabel ?? region.targetEntityLabel ?? "New region"}
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
        {formatBounds(region.bounds)} · {region.bounds.endRow - region.bounds.startRow + 1} rows ·{" "}
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
          <Typography variant="subtitle2" color="warning.dark" sx={{ mb: 0.5 }}>
            Drift detected {region.drift?.identityChanging ? "— identity changing" : ""}
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
              <Button size="small" variant="contained" onClick={onAcceptProposedIdentity}>
                Accept {driftProposedIdentityLabel ?? "new identity"}
              </Button>
              <Button size="small" variant="outlined" onClick={onKeepPriorIdentity}>
                Keep prior
              </Button>
            </Stack>
          )}
        </Box>
      )}

      <TextInput
        label="Label"
        size="small"
        fullWidth
        value={region.proposedLabel ?? ""}
        onChange={(e) => onUpdate({ proposedLabel: e.target.value })}
        placeholder="Optional region label"
      />

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
        options={entityOptions}
        placeholder="Select entity…"
        slotProps={{ htmlInput: { "aria-invalid": Boolean(errors.targetEntityDefinitionId) } }}
      />

      {siblingsInSameEntity > 0 && region.targetEntityDefinitionId && (
        <Typography variant="caption" color="text.secondary">
          Merges into entity with {siblingsInSameEntity} other{" "}
          {siblingsInSameEntity === 1 ? "region" : "regions"}. AI field mapping runs once across all
          merged regions.
        </Typography>
      )}

      <Divider flexItem />

      <Stack spacing={1}>
        <Typography variant="caption" sx={{ fontWeight: 600, textTransform: "uppercase", color: "text.secondary" }}>
          Orientation
        </Typography>
        <ToggleRow
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
          <Typography variant="caption" sx={{ fontWeight: 600, textTransform: "uppercase", color: "text.secondary" }}>
            Header axis
          </Typography>
          <ToggleRow
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
          <Typography variant="caption" sx={{ fontWeight: 600, textTransform: "uppercase", color: "text.secondary" }}>
            Field names
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Auto-generated from position. Override any name below.
          </Typography>
          <FieldNameEditor region={region} onUpdate={onUpdate} />
        </Stack>
      )}

      <Stack spacing={1}>
        <Typography variant="caption" sx={{ fontWeight: 600, textTransform: "uppercase", color: "text.secondary" }}>
          Extent
        </Typography>
        <ToggleRow<BoundsMode>
          value={region.boundsMode ?? "absolute"}
          onChange={(v) =>
            onUpdate({
              boundsMode: v,
              boundsPattern: v === "matchesPattern" ? region.boundsPattern ?? "" : undefined,
            })
          }
          options={[
            { value: "absolute", label: "Fixed" },
            { value: "untilEmpty", label: "Until empty" },
            { value: "matchesPattern", label: "Matches pattern" },
          ]}
        />
        <Typography variant="caption" color="text.secondary">
          {extentDescription(region.orientation, region.boundsMode ?? "absolute")}
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
            slotProps={{ htmlInput: { "aria-invalid": Boolean(errors.boundsPattern) } }}
          />
        )}
      </Stack>

      <SkipAndTerminatorEditor region={region} onUpdate={onUpdate} />

      {pivoted && (
        <Stack spacing={1}>
          <Typography variant="caption" sx={{ fontWeight: 600, textTransform: "uppercase", color: "text.secondary" }}>
            {crosstab ? "Row-axis name" : "Records-axis name"}
          </Typography>
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
              placeholder={crosstab ? "e.g. Quarter, Region" : "e.g. Month, Region, Year"}
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
              <Button size="small" variant="outlined" onClick={onSuggestAxisName}>
                Suggest
              </Button>
            )}
          </Stack>
          {region.recordsAxisName?.source === "ai" && (
            <Typography variant="caption" sx={{ color: "warning.dark" }}>
              AI suggestion — confirm before continuing.
            </Typography>
          )}
        </Stack>
      )}

      {crosstab && (
        <Stack spacing={1}>
          <Typography variant="caption" sx={{ fontWeight: 600, textTransform: "uppercase", color: "text.secondary" }}>
            Column-axis name
          </Typography>
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
            helperText={needsSecondaryAxisName ? "Required — names the column dimension" : undefined}
            slotProps={{ htmlInput: { "aria-invalid": needsSecondaryAxisName } }}
          />
        </Stack>
      )}

      {crosstab && (
        <Stack spacing={1}>
          <Typography variant="caption" sx={{ fontWeight: 600, textTransform: "uppercase", color: "text.secondary" }}>
            Cell value name
          </Typography>
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

      {band !== "none" && (
        <Stack direction="row" spacing={1} alignItems="center">
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
            {region.confidence !== undefined ? `${Math.round(region.confidence * 100)}%` : "—"}
          </Typography>
        </Stack>
      )}
    </Stack>
  );
};

interface ToggleRowProps<T extends string> {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
}

interface SkipAndTerminatorEditorProps {
  region: RegionDraft;
  onUpdate: (updates: Partial<RegionDraft>) => void;
}

const SkipAndTerminatorEditor: React.FC<SkipAndTerminatorEditorProps> = ({
  region,
  onUpdate,
}) => {
  const rules = region.skipRules ?? [];
  const hasBlankRule = rules.some((r) => r.kind === "blank");
  const recordAxisLabel =
    region.orientation === "columns-as-records" ? "column" : "row";
  const crossAxisLabel =
    region.orientation === "columns-as-records" ? "row" : "column";
  const terminatorCount =
    region.untilEmptyTerminatorCount ?? DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT;

  const setRules = (next: SkipRule[]) =>
    onUpdate({ skipRules: next.length > 0 ? next : undefined });

  return (
    <Stack spacing={1}>
      <Typography
        variant="caption"
        sx={{ fontWeight: 600, textTransform: "uppercase", color: "text.secondary" }}
      >
        Skip rules
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {region.boundsMode === "untilEmpty"
          ? "Records matching a skip rule are omitted and do not count toward the terminator."
          : "Records matching a skip rule are omitted from the extracted output."}
      </Typography>

      <Stack direction="row" spacing={1} alignItems="center">
        <Checkbox
          size="small"
          checked={hasBlankRule}
          onChange={(_e, checked) => {
            const next = checked
              ? [...rules.filter((r) => r.kind !== "blank"), { kind: "blank" as const }]
              : rules.filter((r) => r.kind !== "blank");
            setRules(next);
          }}
        />
        <Typography variant="body2">Skip blank {recordAxisLabel}s</Typography>
      </Stack>

      {rules.map((rule, idx) => {
        if (rule.kind !== "cellMatches") return null;
        return (
          <Stack
            key={idx}
            direction="row"
            spacing={1}
            alignItems="flex-start"
            flexWrap="wrap"
            useFlexGap
          >
            <Typography variant="caption" sx={{ minWidth: 0, alignSelf: "center" }}>
              {crossAxisLabel === "column" ? "Column" : "Row"}
            </Typography>
            <TextInput
              size="small"
              sx={{ width: 72 }}
              value={
                crossAxisLabel === "column"
                  ? colIndexToLetter(rule.crossAxisIndex)
                  : String(rule.crossAxisIndex + 1)
              }
              onChange={(e) => {
                const v = e.target.value.trim();
                let nextIndex = rule.crossAxisIndex;
                if (crossAxisLabel === "column") {
                  const letters = v.toUpperCase().replace(/[^A-Z]/g, "");
                  if (letters) {
                    let n = 0;
                    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
                    nextIndex = n - 1;
                  }
                } else {
                  const num = parseInt(v, 10);
                  if (!Number.isNaN(num) && num > 0) nextIndex = num - 1;
                }
                setRules(
                  rules.map((r, i) =>
                    i === idx && r.kind === "cellMatches"
                      ? { ...r, crossAxisIndex: nextIndex }
                      : r
                  )
                );
              }}
              slotProps={{ htmlInput: { "aria-label": "Cell position" } }}
            />
            <Typography variant="caption" sx={{ alignSelf: "center" }}>
              matches
            </Typography>
            <TextInput
              size="small"
              sx={{ flex: 1, minWidth: 120 }}
              value={rule.pattern}
              onChange={(e) =>
                setRules(
                  rules.map((r, i) =>
                    i === idx && r.kind === "cellMatches"
                      ? { ...r, pattern: e.target.value }
                      : r
                  )
                )
              }
              placeholder="e.g. ^— .* —$"
              slotProps={{ htmlInput: { "aria-label": "Skip pattern" } }}
            />
            <IconButton
              size="small"
              aria-label="Remove skip rule"
              icon={IconName.Close}
              onClick={() => setRules(rules.filter((_, i) => i !== idx))}
              sx={{ alignSelf: "center", flexShrink: 0 }}
            />
          </Stack>
        );
      })}

      <Button
        size="small"
        variant="outlined"
        onClick={() =>
          setRules([
            ...rules,
            { kind: "cellMatches", crossAxisIndex: region.bounds.startCol, pattern: "" },
          ])
        }
        sx={{ alignSelf: "flex-start" }}
      >
        + Add cell-match rule
      </Button>

      {region.boundsMode === "untilEmpty" && (
        <Stack spacing={0.5} sx={{ pt: 1 }}>
          <Typography
            variant="caption"
            sx={{ fontWeight: 600, textTransform: "uppercase", color: "text.secondary" }}
          >
            Terminator
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="caption" color="text.secondary">
              Stop after
            </Typography>
            <TextInput
              size="small"
              type="number"
              sx={{ width: 72 }}
              value={String(terminatorCount)}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isNaN(n) || n < 1) {
                  onUpdate({ untilEmptyTerminatorCount: undefined });
                  return;
                }
                onUpdate({ untilEmptyTerminatorCount: n });
              }}
              slotProps={{ htmlInput: { min: 1, "aria-label": "Terminator count" } }}
            />
            <Typography variant="caption" color="text.secondary">
              consecutive unskippable blank {recordAxisLabel}s (default {DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT}).
            </Typography>
          </Stack>
        </Stack>
      )}
    </Stack>
  );
};

interface FieldNameEditorProps {
  region: RegionDraft;
  onUpdate: (updates: Partial<RegionDraft>) => void;
}

const FieldNameEditor: React.FC<FieldNameEditorProps> = ({ region, onUpdate }) => {
  const defaults = defaultFieldNamesForRegion(region.bounds, region.orientation);
  const overrides = region.columnOverrides ?? {};
  return (
    <Stack spacing={0.75}>
      {defaults.map((defaultName) => (
        <Stack key={defaultName} direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              width: 88,
              fontFamily: "monospace",
              fontSize: 12,
              color: "text.secondary",
              flexShrink: 0,
            }}
          >
            {defaultName}
          </Box>
          <TextInput
            size="small"
            fullWidth
            value={overrides[defaultName] ?? ""}
            onChange={(e) => {
              const nextOverrides = { ...overrides };
              if (e.target.value) {
                nextOverrides[defaultName] = e.target.value;
              } else {
                delete nextOverrides[defaultName];
              }
              onUpdate({
                columnOverrides:
                  Object.keys(nextOverrides).length > 0 ? nextOverrides : undefined,
              });
            }}
            placeholder={defaultName}
          />
        </Stack>
      ))}
    </Stack>
  );
};

function ToggleRow<T extends string>({ value, onChange, options }: ToggleRowProps<T>) {
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Button
            key={o.value}
            size="small"
            variant={active ? "contained" : "outlined"}
            onClick={() => onChange(o.value)}
            sx={{ flex: 1, textTransform: "none", minWidth: 0 }}
          >
            {o.label}
          </Button>
        );
      })}
    </Stack>
  );
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
