import React from "react";
import {
  Stack,
  Typography,
  TextInput,
  Button,
  IconButton,
  Checkbox,
  Select,
} from "@portalai/core/ui";
import { IconName } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";

import { CellPositionInputUI } from "./CellPositionInput.component";
import { SectionHelpUI } from "./SectionHelp.component";
import type {
  RegionDraft,
  SkipRuleDraft,
} from "./utils/region-editor.types";
import type { RegionErrors } from "./utils/region-editor-validation.util";
import { isDraftCrosstab } from "./utils/region-orientation.util";

export interface SkipAndTerminatorEditorUIProps {
  region: RegionDraft;
  onUpdate: (updates: Partial<RegionDraft>) => void;
  errors?: RegionErrors;
}

function recordAxisLabel(region: RegionDraft): "row" | "column" {
  // The record axis is the complement of the header axis (1D), the
  // user-declared `recordsAxis` (headerless), or undefined (crosstab —
  // handled separately). Default to row so the copy stays sensible for
  // in-progress drafts.
  const axes = region.headerAxes ?? [];
  if (axes.length === 1) {
    return axes[0] === "row" ? "column" : "row";
  }
  if (axes.length === 0 && region.recordsAxis) return region.recordsAxis;
  return "row";
}

export const SkipAndTerminatorEditorUI: React.FC<
  SkipAndTerminatorEditorUIProps
> = ({ region, onUpdate, errors }) => {
  const rules = region.skipRules ?? [];
  const hasBlankRule = rules.some((r) => r.kind === "blank");
  const isCrosstab = isDraftCrosstab(region);
  const recordAxis = recordAxisLabel(region);
  const crossAxisLabel: "row" | "column" = recordAxis === "row" ? "column" : "row";

  const axisOptions: SelectOption[] = [
    { value: "row", label: "Row" },
    { value: "column", label: "Column" },
  ];

  const setRules = (next: SkipRuleDraft[]) =>
    onUpdate({ skipRules: next.length > 0 ? next : undefined });

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            textTransform: "uppercase",
            color: "text.secondary",
          }}
        >
          Skip rules
        </Typography>
        <SectionHelpUI
          ariaLabel="How do skip rules address rows vs columns?"
          title={
            <>
              <strong>1D regions:</strong> skip rules target entire records
              along the non-header axis. A &ldquo;cell matches&rdquo; rule
              checks a specific cross-axis cell in each record.
              <br />
              <strong>Crosstabs:</strong> each rule can independently target
              rows <em>or</em> columns via the axis selector. A row-axis rule
              checks a column position in each row; a column-axis rule
              checks a row position in each column.
            </>
          }
        />
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Records matching a skip rule are omitted from the extracted output.
        Use ^$ in a cell-match pattern to match empty or null cells.
      </Typography>

      <Checkbox
        size="small"
        checked={hasBlankRule}
        onChange={(checked) => {
          const next = checked
            ? [
                ...rules.filter((r) => r.kind !== "blank"),
                { kind: "blank" as const },
              ]
            : rules.filter((r) => r.kind !== "blank");
          setRules(next);
        }}
        label={
          isCrosstab
            ? "Skip blank rows and columns"
            : `Skip blank ${recordAxis}s`
        }
      />

      <Stack spacing={2}>
        {rules.map((rule, idx) => {
          if (rule.kind !== "cellMatches") return null;
          const patternError = errors?.[`skipRules.${idx}.pattern`];
          const positionError = errors?.[`skipRules.${idx}.crossAxisIndex`];
          const ruleAxis: "row" | "column" = isCrosstab
            ? rule.axis === "column"
              ? "column"
              : "row"
            : crossAxisLabel;
          const positionAxis: "row" | "column" = isCrosstab
            ? ruleAxis === "row"
              ? "column"
              : "row"
            : crossAxisLabel;
          return (
            <Stack
              key={idx}
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              {isCrosstab && (
                <Select
                  size="small"
                  label="Axis"
                  sx={{ minWidth: 104 }}
                  value={rule.axis ?? "row"}
                  onChange={(e) => {
                    const nextAxis = e.target.value as "row" | "column";
                    setRules(
                      rules.map((r, i) =>
                        i === idx && r.kind === "cellMatches"
                          ? { ...r, axis: nextAxis, crossAxisIndex: undefined }
                          : r
                      )
                    );
                  }}
                  options={axisOptions}
                  slotProps={{
                    htmlInput: { "aria-label": "Skip rule axis" },
                  }}
                />
              )}
              <CellPositionInputUI
                axis={positionAxis}
                label={positionAxis === "column" ? "Column" : "Row"}
                index={rule.crossAxisIndex}
                startIndex={
                  positionAxis === "column"
                    ? region.bounds.startCol
                    : region.bounds.startRow
                }
                endIndex={
                  positionAxis === "column"
                    ? region.bounds.endCol
                    : region.bounds.endRow
                }
                onChange={(nextIndex) =>
                  setRules(
                    rules.map((r, i) =>
                      i === idx && r.kind === "cellMatches"
                        ? { ...r, crossAxisIndex: nextIndex }
                        : r
                    )
                  )
                }
                error={Boolean(positionError)}
                helperText={positionError}
              />
              <TextInput
                size="small"
                label="Matches"
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
                placeholder="e.g. ^$ for empty, ^— .* —$"
                required
                error={Boolean(patternError)}
                helperText={patternError}
                slotProps={{
                  htmlInput: {
                    "aria-label": "Skip pattern",
                    "aria-invalid": Boolean(patternError),
                  },
                }}
              />
              <IconButton
                size="small"
                aria-label="Remove skip rule"
                icon={IconName.Close}
                onClick={() => setRules(rules.filter((_, i) => i !== idx))}
                sx={{ flexShrink: 0 }}
              />
            </Stack>
          );
        })}
      </Stack>

      <Button
        size="small"
        variant="outlined"
        onClick={() =>
          setRules([
            ...rules,
            { kind: "cellMatches", crossAxisIndex: undefined, pattern: "" },
          ])
        }
        sx={{ alignSelf: "flex-start" }}
      >
        + Add cell-match rule
      </Button>
    </Stack>
  );
};
