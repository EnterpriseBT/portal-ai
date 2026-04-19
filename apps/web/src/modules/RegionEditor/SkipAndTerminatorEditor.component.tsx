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
import {
  DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT,
  type RegionDraft,
  type SkipRule,
} from "./utils/region-editor.types";
import type { RegionErrors } from "./utils/region-editor-validation.util";

export interface SkipAndTerminatorEditorUIProps {
  region: RegionDraft;
  onUpdate: (updates: Partial<RegionDraft>) => void;
  errors?: RegionErrors;
}

export const SkipAndTerminatorEditorUI: React.FC<SkipAndTerminatorEditorUIProps> = ({
  region,
  onUpdate,
  errors,
}) => {
  const rules = region.skipRules ?? [];
  const hasBlankRule = rules.some((r) => r.kind === "blank");
  const isCrosstab = region.orientation === "cells-as-records";
  const recordAxisLabel =
    region.orientation === "columns-as-records" ? "column" : "row";
  const crossAxisLabel =
    region.orientation === "columns-as-records" ? "row" : "column";
  const terminatorCount =
    region.untilEmptyTerminatorCount ?? DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT;

  const axisOptions: SelectOption[] = [
    { value: "row", label: "Row" },
    { value: "column", label: "Column" },
  ];

  const setRules = (next: SkipRule[]) =>
    onUpdate({ skipRules: next.length > 0 ? next : undefined });

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Typography
          variant="caption"
          sx={{ fontWeight: 600, textTransform: "uppercase", color: "text.secondary" }}
        >
          Skip rules
        </Typography>
        <SectionHelpUI
          ariaLabel="How do orientation and pivots affect skip rules?"
          title={
            <>
              <strong>Rows orientation:</strong> skip rules target entire rows —
              a &ldquo;cell matches&rdquo; rule checks a specific column in each row.
              <br />
              <strong>Columns orientation:</strong> skip rules target entire columns —
              a &ldquo;cell matches&rdquo; rule checks a specific row in each column.
              <br />
              <strong>Cells (crosstab):</strong> each rule can independently target
              rows <em>or</em> columns via the axis selector. A row-axis rule checks a
              column position in each row; a column-axis rule checks a row position in
              each column.
            </>
          }
        />
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {region.boundsMode === "untilEmpty"
          ? "Records matching a skip rule are omitted and do not count toward the terminator."
          : "Records matching a skip rule are omitted from the extracted output."}
      </Typography>

      <Checkbox
        size="small"
        checked={hasBlankRule}
        onChange={(checked) => {
          const next = checked
            ? [...rules.filter((r) => r.kind !== "blank"), { kind: "blank" as const }]
            : rules.filter((r) => r.kind !== "blank");
          setRules(next);
        }}
        label={isCrosstab ? "Skip blank rows and columns" : `Skip blank ${recordAxisLabel}s`}
      />

      <Stack spacing={2}>
        {rules.map((rule, idx) => {
          if (rule.kind !== "cellMatches") return null;
          const patternError = errors?.[`skipRules.${idx}.pattern`];
          const positionError = errors?.[`skipRules.${idx}.crossAxisIndex`];
          // For crosstab the rule's axis determines which dimension the position
          // picker addresses; for non-crosstab orientations use the fixed cross axis.
          const ruleAxis: "row" | "column" = isCrosstab
            ? (rule.axis === "column" ? "column" : "row")
            : crossAxisLabel;
          const positionAxis: "row" | "column" = isCrosstab
            ? (ruleAxis === "row" ? "column" : "row")
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
              placeholder="e.g. ^— .* —$"
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
              error={Boolean(errors?.untilEmptyTerminatorCount)}
              helperText={errors?.untilEmptyTerminatorCount}
              slotProps={{
                htmlInput: {
                  min: 1,
                  "aria-label": "Terminator count",
                  "aria-invalid": Boolean(errors?.untilEmptyTerminatorCount),
                },
              }}
            />
            <Typography variant="caption" color="text.secondary">
              consecutive unskippable blank {isCrosstab ? "rows and columns" : `${recordAxisLabel}s`} (default {DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT}).
            </Typography>
          </Stack>
        </Stack>
      )}
    </Stack>
  );
};
