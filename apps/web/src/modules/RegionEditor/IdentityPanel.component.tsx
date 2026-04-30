import React from "react";

import { Box, Stack, Typography, Select } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import Alert from "@mui/material/Alert";
import MuiChip from "@mui/material/Chip";

import { ConfidenceChipUI } from "./ConfidenceChip.component";
import type { LocatorOption } from "./utils/identity-locator-options.util";

const ROW_POSITION_VALUE = "rowPosition";

export type IdentityChange =
  | { kind: "column"; locator: { axis: "row" | "column"; index: number } }
  | { kind: "rowPosition" };

export interface IdentityPanelCurrentSelection {
  kind: "column" | "composite" | "rowPosition";
  /**
   * Stable key matching one of the `LocatorOption.key` values. When kind is
   * `"column"` and the key is unset (e.g. user just dropped to "no
   * identity"), the dropdown falls back to the position sentinel.
   */
  selectedKey?: string;
  label?: string;
  confidence?: number;
  /**
   * `"user"` flips the confidence chip into a "Set by you" badge —
   * round-tripped from `region.identityStrategy.source`.
   */
  source?: "heuristic" | "user";
}

export interface IdentityPanelUIProps {
  regionId: string;
  currentSelection: IdentityPanelCurrentSelection;
  locatorOptions: LocatorOption[];
  onIdentityChange: (regionId: string, next: IdentityChange) => void;
}

function uniquenessTag(uniqueness: LocatorOption["uniqueness"]): string {
  switch (uniqueness) {
    case "unique":
      return "unique";
    case "non-unique":
      return "may have duplicates";
    case "all-blank":
      return "all blank";
  }
}

function buildOptions(locatorOptions: LocatorOption[]): SelectOption[] {
  const opts: SelectOption[] = locatorOptions.map((o) => ({
    value: o.key,
    label: `${o.label} (${uniquenessTag(o.uniqueness)})`,
  }));
  opts.push({
    value: ROW_POSITION_VALUE,
    label: "Use position-based ids — every sync recreates records",
  });
  return opts;
}

function describeKind(kind: IdentityPanelCurrentSelection["kind"]): string {
  switch (kind) {
    case "column":
      return "Record identity";
    case "composite":
      return "Record identity (composite)";
    case "rowPosition":
      return "No stable identity";
  }
}

function findOption(
  locatorOptions: LocatorOption[],
  selectedKey: string | undefined
): LocatorOption | undefined {
  if (!selectedKey) return undefined;
  return locatorOptions.find((o) => o.key === selectedKey);
}

/**
 * Pure UI for the per-region "Identity" panel inside a review card. The
 * dropdown options + uniqueness flags come from
 * `computeLocatorOptions(region, sheet)` upstream — this component is
 * fed entirely from props and renders the user's pick straight back
 * through `onIdentityChange`. The container translates the change into
 * a draft patch (`regionDraftsToHints` then propagates it as a
 * user-locked identity to the next interpret pass).
 *
 * See `RECORD_IDENTITY_REVIEW.spec.md` §5.1 / Phase D §D.5 step 2.
 */
export const IdentityPanelUI: React.FC<IdentityPanelUIProps> = ({
  regionId,
  currentSelection,
  locatorOptions,
  onIdentityChange,
}) => {
  const options = buildOptions(locatorOptions);
  const valueKey =
    currentSelection.kind === "rowPosition"
      ? ROW_POSITION_VALUE
      : (currentSelection.selectedKey ?? "");

  const handleChange = (e: { target: { value: string | number } }) => {
    const v = String(e.target.value);
    if (v === ROW_POSITION_VALUE) {
      onIdentityChange(regionId, { kind: "rowPosition" });
      return;
    }
    const opt = locatorOptions.find((o) => o.key === v);
    if (!opt) return;
    onIdentityChange(regionId, {
      kind: "column",
      locator: { axis: opt.axis, index: opt.index },
    });
  };

  const selectedOption = findOption(locatorOptions, currentSelection.selectedKey);
  const showDuplicateWarning =
    currentSelection.kind === "column" &&
    selectedOption?.uniqueness === "non-unique";

  return (
    <Box
      sx={{
        p: 1,
        borderRadius: 1,
        backgroundColor: "background.paper",
        border: "1px dashed",
        borderColor: "divider",
      }}
    >
      <Stack spacing={0.75}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {describeKind(currentSelection.kind)}
            {currentSelection.kind === "column" && currentSelection.label
              ? `: ${currentSelection.label}`
              : ""}
          </Typography>
          {currentSelection.source === "user" ? (
            <MuiChip
              label="Set by you"
              size="small"
              variant="outlined"
              sx={{ height: 18 }}
            />
          ) : currentSelection.confidence !== undefined ? (
            <ConfidenceChipUI label="Identity" score={currentSelection.confidence} />
          ) : null}
        </Stack>

        <Select
          size="small"
          label="Identity field"
          value={valueKey}
          onChange={handleChange}
          options={options}
          fullWidth
        />

        {showDuplicateWarning && (
          <Alert severity="warning" variant="outlined" sx={{ py: 0.5 }}>
            <Typography variant="caption">
              This locator has duplicate values; sync will fail with a
              unique-key conflict during upsert. Pick another field or use
              position-based ids.
            </Typography>
          </Alert>
        )}
      </Stack>
    </Box>
  );
};
