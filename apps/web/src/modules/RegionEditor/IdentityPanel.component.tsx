import React from "react";

import { Box, Checkbox, Stack, Typography, Select } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import Alert from "@mui/material/Alert";
import MuiChip from "@mui/material/Chip";

import { ConfidenceChipUI } from "./ConfidenceChip.component";
import type { LocatorOption } from "./utils/identity-locator-options.util";

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
    case "unknown":
      // Sliced-sheet verdict: preview window can't confirm uniqueness;
      // the commit-time drift gate is the authoritative check.
      return "uniqueness unknown — verified at commit";
  }
}

function buildOptions(locatorOptions: LocatorOption[]): SelectOption[] {
  // The position-based option used to live inside this dropdown but
  // got lost when the column list is long — surfaced as a sibling
  // checkbox above the Select instead. Keep this list column-only.
  return locatorOptions.map((o) => ({
    value: o.key,
    label: `${o.label} (${uniquenessTag(o.uniqueness)})`,
  }));
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
  const isPositionBased = currentSelection.kind === "rowPosition";
  const hasColumnOptions = locatorOptions.length > 0;
  const valueKey = isPositionBased ? "" : (currentSelection.selectedKey ?? "");

  const handleChange = (e: { target: { value: string | number } }) => {
    const v = String(e.target.value);
    const opt = locatorOptions.find((o) => o.key === v);
    if (!opt) return;
    onIdentityChange(regionId, {
      kind: "column",
      locator: { axis: opt.axis, index: opt.index },
    });
  };

  const handlePositionToggle = (checked: boolean) => {
    if (checked) {
      onIdentityChange(regionId, { kind: "rowPosition" });
      return;
    }
    // Unchecking falls back to the first available column option —
    // the user can then refine via the Select. If no column options
    // exist (very rare; means the region has no header / no
    // detectable identity candidates), the checkbox is disabled and
    // we don't reach this branch.
    const first = locatorOptions[0];
    if (!first) return;
    onIdentityChange(regionId, {
      kind: "column",
      locator: { axis: first.axis, index: first.index },
    });
  };

  const selectedOption = findOption(locatorOptions, currentSelection.selectedKey);
  const showDuplicateWarning =
    currentSelection.kind === "column" &&
    selectedOption?.uniqueness === "non-unique";
  // For sliced sheets (large workbooks), the preview window can't
  // confirm uniqueness across the entire data range. Surface a softer
  // warning so the user knows the commit-time drift gate is the
  // authoritative check — and that picking a locator the full data
  // set duplicates will fail the commit with
  // `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED`.
  const showUnknownNotice =
    currentSelection.kind === "column" &&
    selectedOption?.uniqueness === "unknown";

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

        <Checkbox
          size="small"
          checked={isPositionBased}
          disabled={!hasColumnOptions}
          onChange={handlePositionToggle}
          label={
            <Typography variant="caption">
              Use position-based ids — every sync recreates records
            </Typography>
          }
        />

        <Select
          size="small"
          label="Identity field"
          value={valueKey}
          onChange={handleChange}
          options={options}
          fullWidth
          disabled={isPositionBased}
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

        {showUnknownNotice && (
          <Alert severity="info" variant="outlined" sx={{ py: 0.5 }}>
            <Typography variant="caption">
              The preview only loaded part of the sheet, so duplicates in
              unloaded rows can&apos;t be detected here. Commit will fail
              with a duplicate-identity error if the full data set has
              repeats — switch to position-based ids if you&apos;re not
              sure.
            </Typography>
          </Alert>
        )}
      </Stack>
    </Box>
  );
};
