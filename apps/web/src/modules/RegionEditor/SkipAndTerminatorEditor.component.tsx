import React from "react";
import {
  Stack,
  Typography,
  TextInput,
  Button,
  IconButton,
  Checkbox,
} from "@portalai/core/ui";
import { IconName } from "@portalai/core/ui";

import { CellPositionInputUI } from "./CellPositionInput.component";
import {
  DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT,
  type RegionDraft,
  type SkipRule,
} from "./utils/region-editor.types";

export interface SkipAndTerminatorEditorUIProps {
  region: RegionDraft;
  onUpdate: (updates: Partial<RegionDraft>) => void;
}

export const SkipAndTerminatorEditorUI: React.FC<SkipAndTerminatorEditorUIProps> = ({
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
          onChange={(checked) => {
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
            <CellPositionInputUI
              axis={crossAxisLabel}
              index={rule.crossAxisIndex}
              startIndex={
                crossAxisLabel === "column"
                  ? region.bounds.startCol
                  : region.bounds.startRow
              }
              endIndex={
                crossAxisLabel === "column"
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
