import React, { useMemo, useState } from "react";
import {
  Box,
  Stack,
  Typography,
  Button,
  Divider,
  Icon,
  IconName,
  Tooltip,
} from "@portalai/core/ui";
import TextField from "@mui/material/TextField";

import { ConfidenceChipUI } from "./ConfidenceChip.component";
import { IdentityPanelUI } from "./IdentityPanel.component";
import type {
  IdentityChange,
  IdentityPanelCurrentSelection,
} from "./IdentityPanel.component";
import { WarningRowUI } from "./WarningRow.component";
import { formatBounds } from "./utils/a1-notation.util";
import { confidenceBand } from "./utils/region-editor-colors.util";
import type { LocatorOption } from "./utils/identity-locator-options.util";
import type { RegionDraft } from "./utils/region-editor.types";
import type { RegionBindingErrors } from "./utils/region-editor-validation.util";

type ChipBand = ReturnType<typeof confidenceBand>;

export interface RegionReviewCardUIProps {
  region: RegionDraft;
  onJump: () => void;
  /**
   * Fires when a binding chip is clicked. Receives the serialised
   * sourceLocator and the chip DOM node so callers can anchor a popover to
   * the clicked chip (the `ReviewStepUI` binding editor does).
   */
  onEditBinding: (sourceLocator: string, anchorEl: HTMLElement) => void;
  /**
   * Per-binding validation errors keyed by serialised `sourceLocator`.
   * Chips with an entry render in the error palette with an "Invalid" pill
   * so the user can spot problem bindings without opening each one.
   */
  bindingErrors?: RegionBindingErrors;
  /**
   * Looks up a ColumnDefinition's display label by id. Used to resolve labels
   * for the pivot-segment and cellValueField chips, which carry only a
   * `columnDefinitionId` (no embedded label like a `ColumnBindingDraft`).
   */
  resolveColumnLabel?: (columnDefinitionId: string) => string | undefined;
  /**
   * Pre-computed dropdown options for the IdentityPanel (one entry per
   * candidate column or row inside the region's bounds). Container builds
   * these from `computeLocatorOptions(region, sheet)` and passes them as a
   * prop so the card stays workbook-agnostic. Omit to hide the panel
   * entirely (e.g. when no sheet is available).
   */
  identityLocatorOptions?: LocatorOption[];
  /**
   * Fires when the user picks a different identity from the dropdown. The
   * caller turns the `IdentityChange` into a `RegionDraft` patch with
   * `identityStrategy.source = "user"` so the lock survives interpret.
   */
  onIdentityUpdate?: (regionId: string, change: IdentityChange) => void;
}

/**
 * Pull a human-readable source label from a serialised locator string.
 * `header:axis:name` → the header name; `pos:axis:index` → the binding's
 * `normalizedKey` (when the back-end emitted one — typically because the
 * user supplied a `headers[i]` override over a blank cell), otherwise a
 * `Pos {axis} {index}` placeholder. Falls back to the raw locator for
 * any unrecognised shape so the chip never renders empty.
 */
function bindingSourceLabel(
  serializedLocator: string,
  binding: { normalizedKey?: string }
): string {
  if (serializedLocator.startsWith("header:")) {
    const parts = serializedLocator.split(":");
    if (parts.length >= 3) return parts.slice(2).join(":");
  }
  if (serializedLocator.startsWith("pos:")) {
    if (binding.normalizedKey) return binding.normalizedKey;
    const parts = serializedLocator.split(":");
    if (parts.length === 3) return `Pos ${parts[1]} ${parts[2]}`;
  }
  return serializedLocator;
}

interface ReviewChip {
  key: string;
  /** Source label rendered on the left of the chip arrow. */
  source: string;
  /** Display label rendered on the right; falls back to id, then "—". */
  columnDefinitionLabel?: string;
  columnDefinitionId?: string | null;
  band: ChipBand;
  excluded: boolean;
  invalid: boolean;
  /**
   * Numeric AI-classifier confidence in the [0, 1] range, surfaced inline on
   * the chip and in the tooltip so the user can see *why* the icon is what
   * it is and whether to second-guess a low-confidence bound binding.
   * Column bindings always carry a confidence; pivot / intersection /
   * cellValueField chips don't have a numeric classifier confidence and
   * leave this undefined.
   */
  confidence?: number;
  /**
   * First validation-error message for an invalid column binding, surfaced in
   * the chip's tooltip so the user can see what's wrong without clicking
   * into the popover. Logical-field chips (pivot / cellValueField /
   * intersection) don't carry per-field validation errors and leave this
   * undefined.
   */
  errorMessage?: string;
  /**
   * Optional click handler. Logical-field chips (pivot axisName,
   * cellValueField) leave this undefined since this card doesn't yet support
   * editing those slots — they render as a static chip with the same shape.
   */
  onClick?: (anchorEl: HTMLElement) => void;
  ariaLabel: string;
}

function buildChips(
  region: RegionDraft,
  bindingErrors: RegionBindingErrors | undefined,
  onEditBinding: RegionReviewCardUIProps["onEditBinding"],
  resolveColumnLabel: RegionReviewCardUIProps["resolveColumnLabel"]
): ReviewChip[] {
  const chips: ReviewChip[] = [];

  for (const binding of region.columnBindings ?? []) {
    const excluded = binding.excluded === true;
    const errors = bindingErrors?.[binding.sourceLocator];
    const invalid = !excluded && errors !== undefined;
    const errorMessage = invalid && errors ? Object.values(errors)[0] : undefined;
    const sourceLabel = bindingSourceLabel(binding.sourceLocator, binding);
    chips.push({
      key: `binding:${binding.sourceLocator}`,
      source: sourceLabel,
      columnDefinitionLabel: binding.columnDefinitionLabel,
      columnDefinitionId: binding.columnDefinitionId,
      band: confidenceBand(binding.confidence),
      excluded,
      invalid,
      confidence: binding.confidence,
      errorMessage,
      onClick: (anchor) => onEditBinding(binding.sourceLocator, anchor),
      ariaLabel: excluded
        ? `Excluded — click to edit: ${sourceLabel}`
        : invalid
          ? `Invalid — click to edit: ${sourceLabel}`
          : `Edit binding: ${sourceLabel}`,
    });
  }

  for (const axis of ["row", "column"] as const) {
    for (const seg of region.segmentsByAxis?.[axis] ?? []) {
      if (seg.kind !== "pivot") continue;
      const id = seg.columnDefinitionId;
      const label = id ? resolveColumnLabel?.(id) : undefined;
      const excluded = seg.excluded === true;
      // Pivot segment binds to the catalog by name match — band tracks
      // whether the slot is filled, not a numeric confidence we'd otherwise
      // surface in the popover. The "Unbound" pill is suppressed for
      // excluded chips since the user has opted them out anyway.
      const sourceLocator = `pivot:${seg.id}`;
      chips.push({
        key: `pivot:${seg.id}`,
        source: seg.axisName,
        columnDefinitionLabel: label,
        columnDefinitionId: id ?? null,
        band: id ? "green" : "red",
        excluded,
        invalid: !excluded && !id,
        onClick: (anchor) => onEditBinding(sourceLocator, anchor),
        ariaLabel: excluded
          ? `Excluded — click to edit pivot axis "${seg.axisName}"`
          : id
            ? `Edit pivot axis "${seg.axisName}" — bound to ${label ?? id}`
            : `Edit pivot axis "${seg.axisName}" — unbound`,
      });
    }
  }

  // Per-intersection cell-value fields take precedence over the
  // region-level `cellValueField` chip on a 2D crosstab — each
  // intersection is its own field with its own classification, so
  // surface each as its own chip. The region-level "value" default is
  // a fallback that ceases to be the canonical name once an
  // intersection override is set.
  const intersectionEntries = region.intersectionCellValueFields
    ? Object.entries(region.intersectionCellValueFields)
    : [];
  if (intersectionEntries.length > 0) {
    for (const [id, field] of intersectionEntries) {
      const colDefId = field.columnDefinitionId;
      const label = colDefId ? resolveColumnLabel?.(colDefId) : undefined;
      const excluded = field.excluded === true;
      const sourceLocator = `intersection:${id}`;
      chips.push({
        key: `intersection:${id}`,
        source: field.name,
        columnDefinitionLabel: label,
        columnDefinitionId: colDefId ?? null,
        band: colDefId ? "green" : "red",
        excluded,
        invalid: !excluded && !colDefId,
        onClick: (anchor) => onEditBinding(sourceLocator, anchor),
        ariaLabel: excluded
          ? `Excluded — click to edit intersection cell value "${field.name}"`
          : colDefId
            ? `Edit intersection cell value "${field.name}" — bound to ${label ?? colDefId}`
            : `Edit intersection cell value "${field.name}" — unbound`,
      });
    }
  } else if (region.cellValueField) {
    const id = region.cellValueField.columnDefinitionId;
    const label = id ? resolveColumnLabel?.(id) : undefined;
    const excluded = region.cellValueField.excluded === true;
    const sourceLocator = "cellValueField";
    chips.push({
      key: "cellValueField",
      source: region.cellValueField.name,
      columnDefinitionLabel: label,
      columnDefinitionId: id ?? null,
      band: id ? "green" : "red",
      excluded,
      invalid: !excluded && !id,
      onClick: (anchor) => onEditBinding(sourceLocator, anchor),
      ariaLabel: excluded
        ? `Excluded — click to edit cell value "${region.cellValueField.name}"`
        : id
          ? `Edit cell value "${region.cellValueField.name}" — bound to ${label ?? id}`
          : `Edit cell value "${region.cellValueField.name}" — unbound`,
    });
  }

  return chips;
}

function chipPriority(chip: ReviewChip): number {
  if (!chip.excluded && chip.invalid) return 0;
  if (!chip.excluded && !chip.invalid && chip.band === "red") return 1;
  if (!chip.excluded) return 2;
  return 3;
}

function sortChips(chips: ReviewChip[]): ReviewChip[] {
  return [...chips].sort((a, b) => {
    const dp = chipPriority(a) - chipPriority(b);
    if (dp !== 0) return dp;
    return a.source.localeCompare(b.source, undefined, {
      sensitivity: "base",
    });
  });
}

function buildIdentitySelection(
  region: RegionDraft,
  options: LocatorOption[] | undefined
): IdentityPanelCurrentSelection {
  const strat = region.identityStrategy;
  if (!strat) {
    return { kind: "rowPosition" };
  }
  if (strat.kind === "rowPosition") {
    return {
      kind: "rowPosition",
      source: strat.source,
      confidence: strat.confidence,
    };
  }
  if (strat.kind === "composite") {
    return {
      kind: "composite",
      source: strat.source,
      confidence: strat.confidence,
    };
  }
  // strat.kind === "column": match the structured locator against the
  // dropdown's option list to recover the selected key + label.
  const loc = strat.rawLocator;
  let selectedKey: string | undefined;
  let label: string | undefined;
  if (loc?.kind === "column") {
    selectedKey = `col:${loc.col - 1}`;
  } else if (loc?.kind === "row") {
    selectedKey = `row:${loc.row - 1}`;
  }
  if (selectedKey && options) {
    const match = options.find((o) => o.key === selectedKey);
    if (match) label = match.label;
  }
  return {
    kind: "column",
    selectedKey,
    label,
    source: strat.source,
    confidence: strat.confidence,
  };
}

export const RegionReviewCardUI: React.FC<RegionReviewCardUIProps> = ({
  region,
  onJump,
  onEditBinding,
  bindingErrors,
  resolveColumnLabel,
  identityLocatorOptions,
  onIdentityUpdate,
}) => {
  const chips = useMemo(
    () =>
      sortChips(
        buildChips(region, bindingErrors, onEditBinding, resolveColumnLabel)
      ),
    [region, bindingErrors, onEditBinding, resolveColumnLabel]
  );
  const [filter, setFilter] = useState("");
  const showFilterInput = chips.length > 8;
  const trimmedFilter = filter.trim().toLowerCase();
  const filteredChips = useMemo(() => {
    if (trimmedFilter === "") return chips;
    return chips.filter(
      (chip) =>
        chip.source.toLowerCase().includes(trimmedFilter) ||
        (chip.columnDefinitionLabel ?? "")
          .toLowerCase()
          .includes(trimmedFilter) ||
        (chip.columnDefinitionId ?? "").toLowerCase().includes(trimmedFilter)
    );
  }, [chips, trimmedFilter]);
  const showIdentityPanel =
    identityLocatorOptions !== undefined &&
    onIdentityUpdate !== undefined &&
    identityLocatorOptions.length > 0;
  const identitySelection = buildIdentitySelection(
    region,
    identityLocatorOptions
  );

  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 1,
        backgroundColor: "grey.50",
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        spacing={1}
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: 0.5 }}
      >
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {region.proposedLabel ?? formatBounds(region.bounds)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatBounds(region.bounds)}
          </Typography>
          <ConfidenceChipUI label="Region" score={region.confidence} />
        </Stack>
        <Button size="small" variant="text" onClick={onJump}>
          Jump to region
        </Button>
      </Stack>

      {showIdentityPanel && (
        <>
          <Divider sx={{ my: 1 }} />
          <IdentityPanelUI
            regionId={region.id}
            currentSelection={identitySelection}
            locatorOptions={identityLocatorOptions!}
            onIdentityChange={onIdentityUpdate!}
          />
        </>
      )}

      {chips.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          {showFilterInput && (
            <TextField
              size="small"
              fullWidth
              placeholder="Filter fields…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              slotProps={{
                htmlInput: { "aria-label": "Filter region fields" },
              }}
              sx={{ mb: 1 }}
            />
          )}
          {filteredChips.length === 0 && trimmedFilter !== "" ? (
            <Typography variant="caption" color="text.secondary">
              No fields match.
            </Typography>
          ) : (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {filteredChips.map((chip) => {
              const interactive = chip.onClick !== undefined;
              // Resolve the chip's status — drives the leading icon (the
              // single visual axis the user scans for problems), the chip's
              // own background tint for the most-attention case, and the
              // tooltip copy. "Unbound" is gated strictly on the absence of
              // a columnDefinitionId so the chip's icon matches the
              // popover's icon for the same binding (popover uses the same
              // rule). Confidence-band tinting is informational only and no
              // longer participates in state classification.
              const stateName: "bound" | "unbound" | "invalid" | "excluded" =
                chip.excluded
                  ? "excluded"
                  : chip.invalid && chip.columnDefinitionId
                    ? "invalid"
                    : !chip.columnDefinitionId
                      ? "unbound"
                      : "bound";
              const iconName =
                stateName === "excluded"
                  ? IconName.Block
                  : stateName === "invalid"
                    ? IconName.Error
                    : stateName === "unbound"
                      ? IconName.Warning
                      : IconName.CheckCircle;
              const iconColor =
                stateName === "excluded"
                  ? "text.disabled"
                  : stateName === "invalid"
                    ? "error.main"
                    : stateName === "unbound"
                      ? "warning.main"
                      : "success.main";
              const targetLabel =
                chip.columnDefinitionLabel ?? chip.columnDefinitionId ?? null;
              const confidencePct =
                chip.confidence !== undefined
                  ? Math.round(chip.confidence * 100)
                  : undefined;
              const confidenceTooltipSuffix =
                confidencePct !== undefined
                  ? ` (${confidencePct}% AI confidence)`
                  : "";
              const tooltipCopy =
                stateName === "excluded"
                  ? `Excluded — no field mapping will be created for this column.${confidenceTooltipSuffix}`
                  : stateName === "invalid"
                    ? `Invalid — ${chip.errorMessage ?? "click to fix the binding."}${confidenceTooltipSuffix}`
                    : stateName === "unbound"
                      ? `Unbound — pick a column definition to map this column.${confidenceTooltipSuffix}`
                      : `Bound${targetLabel ? ` to ${targetLabel}` : ""} — this column is mapped to a column definition.${confidenceTooltipSuffix}`;
              // Native `<button>` styling resolves text color against
              // `buttontext` / `Canvas` instead of the document's
              // `text.primary`, which on the grey.50 card background
              // renders as a near-invisible pale gray. Lock both the color
              // and font-family to the document so interactive (button)
              // chips and display-only (div) chips look identical.
              const sx = {
                display: "inline-flex",
                alignItems: "center",
                gap: 0.5,
                px: 1,
                py: 0.25,
                borderRadius: 16,
                border: "1px solid",
                borderColor: "divider",
                backgroundColor: chip.invalid
                  ? "error.light"
                  : "background.paper",
                color: "text.primary",
                fontFamily: "inherit",
                cursor: interactive ? "pointer" : "default",
                fontSize: 12,
                opacity: chip.excluded ? 0.55 : 1,
                textDecoration: chip.excluded ? "line-through" : "none",
              } as const;
              const inner = (
                <>
                  <Icon
                    name={iconName}
                    sx={{ fontSize: 16, color: iconColor }}
                    data-testid={`chip-icon-${stateName}`}
                  />
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {chip.source}
                  </Typography>
                  <span>→</span>
                  <Typography variant="caption">
                    {chip.columnDefinitionLabel ??
                      chip.columnDefinitionId ??
                      "—"}
                  </Typography>
                  {confidencePct !== undefined && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      data-testid="chip-confidence"
                      sx={{ ml: 0.25 }}
                    >
                      · {confidencePct}%
                    </Typography>
                  )}
                </>
              );
              return interactive ? (
                <Tooltip key={chip.key} title={tooltipCopy} arrow>
                  <Box
                    component="button"
                    type="button"
                    aria-label={chip.ariaLabel}
                    onClick={(e) =>
                      chip.onClick!(e.currentTarget as HTMLElement)
                    }
                    sx={sx}
                  >
                    {inner}
                  </Box>
                </Tooltip>
              ) : (
                <Tooltip key={chip.key} title={tooltipCopy} arrow>
                  <Box role="status" aria-label={chip.ariaLabel} sx={sx}>
                    {inner}
                  </Box>
                </Tooltip>
              );
            })}
          </Stack>
          )}
        </>
      )}

      {region.warnings && region.warnings.length > 0 && (
        <Stack spacing={0.75} sx={{ mt: 1 }}>
          {region.warnings.map((w, i) => (
            <WarningRowUI key={i} warning={w} onJump={onJump} />
          ))}
        </Stack>
      )}
    </Box>
  );
};
