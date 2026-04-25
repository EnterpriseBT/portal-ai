import React, { useState } from "react";
import { Box, Stack, Typography, Button } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import Alert from "@mui/material/Alert";
import type { ColumnDataType } from "@portalai/core/models";
import {
  sourceFieldToNormalizedKey,
  sourceLocatorToNormalizedKey,
} from "@portalai/core/contracts";

import { ConfidenceChipUI } from "./ConfidenceChip.component";
import { RegionReviewCardUI } from "./RegionReviewCard.component";
import { BindingEditorPopoverUI } from "./BindingEditorPopover.component";
import { applyBindingDraftPatch } from "./utils/binding-draft.util";
import { colorForEntity } from "./utils/region-editor-colors.util";
import {
  validateBindingDraft,
  validateRegionBindings,
} from "./utils/region-editor-validation.util";
import type { RegionBindingErrors } from "./utils/region-editor-validation.util";
import type {
  ColumnBindingDraft,
  RegionDraft,
} from "./utils/region-editor.types";
import type { SearchResult } from "../../api/types";
import type { ServerError } from "../../utils/api.util";
import type { FormErrors } from "../../utils/form-validation.util";

export interface ReviewStepUIProps {
  regions: RegionDraft[];
  overallConfidence?: number;
  onJumpToRegion: (regionId: string) => void;
  onEditBinding: (regionId: string, sourceLocator: string) => void;
  onCommit: () => void;
  onBack: () => void;
  isCommitting?: boolean;
  commitDisabledReason?: string | null;
  /**
   * When set (together with `onToggleBindingExcluded` and
   * `columnDefinitionSearch`), clicking a binding chip opens the
   * `BindingEditorPopover` locally — `onEditBinding` becomes a fallback that
   * legacy consumers without the popover dependencies can still rely on.
   */
  onUpdateBinding?: (
    regionId: string,
    sourceLocator: string,
    patch: Partial<ColumnBindingDraft>
  ) => void;
  onToggleBindingExcluded?: (
    regionId: string,
    sourceLocator: string,
    excluded: boolean
  ) => void;
  columnDefinitionSearch?: SearchResult<SelectOption>;
  /**
   * Compute reference-target options for a given region (sibling staged
   * entities + existing DB entities). The caller owns this because it
   * depends on the plan + an SDK search — the module stays agnostic.
   */
  resolveReferenceOptions?: (region: RegionDraft) => SelectOption[];
  resolveReferenceFieldOptions?: (
    region: RegionDraft,
    refEntityKey: string | null | undefined
  ) => SelectOption[];
  resolveColumnDefinitionType?: (
    binding: ColumnBindingDraft
  ) => ColumnDataType | undefined;
  resolveColumnDefinitionDescription?: (
    binding: ColumnBindingDraft
  ) => string | null | undefined;
  /**
   * Looks up a ColumnDefinition's display label by id. The review card uses
   * this to render labels for the pivot-segment and cellValueField chips —
   * those fields land on `region.segmentsByAxis[*].columnDefinitionId` and
   * `region.cellValueField.columnDefinitionId` respectively, neither of which
   * carries an embedded label like a `ColumnBindingDraft`.
   */
  resolveColumnLabel?: (columnDefinitionId: string) => string | undefined;
}

interface EditingState {
  regionId: string;
  sourceLocator: string;
  anchorEl: HTMLElement;
  draft: ColumnBindingDraft;
  errors: FormErrors;
  serverError: ServerError | null;
}

function draftValidationContext(
  binding: ColumnBindingDraft,
  resolveType?: ReviewStepUIProps["resolveColumnDefinitionType"]
): Parameters<typeof validateBindingDraft>[1] {
  return {
    columnDefinitionType: resolveType?.(binding) ?? undefined,
  };
}

/**
 * Synthetic sourceLocators issued for pivot segments + cellValueField chips.
 * Recognising them up-front lets handleChipClick build a draft from the
 * matching segment / cellValueField slot instead of region.columnBindings,
 * and patchBinding (in the workflow util) routes apply patches back onto
 * `segment.columnDefinitionId` / `cellValueField.columnDefinitionId`. The
 * popover only meaningfully edits `columnDefinitionId` for these — pivot
 * Segment + CellValueField don't carry the override fields a ColumnBinding
 * does.
 */
function parseSyntheticLocator(
  sourceLocator: string
): { kind: "pivot"; segmentId: string } | { kind: "cellValueField" } | null {
  if (sourceLocator === "cellValueField") return { kind: "cellValueField" };
  if (sourceLocator.startsWith("pivot:")) {
    return { kind: "pivot", segmentId: sourceLocator.slice("pivot:".length) };
  }
  return null;
}

function findPivotSegment(
  region: RegionDraft,
  segmentId: string
): {
  axisName: string;
  columnDefinitionId?: string;
  excluded?: boolean;
} | undefined {
  for (const axis of ["row", "column"] as const) {
    for (const seg of region.segmentsByAxis?.[axis] ?? []) {
      if (seg.kind === "pivot" && seg.id === segmentId) {
        return {
          axisName: seg.axisName,
          columnDefinitionId: seg.columnDefinitionId,
          excluded: seg.excluded,
        };
      }
    }
  }
  return undefined;
}

function syntheticBindingDraft(
  region: RegionDraft,
  sourceLocator: string
): ColumnBindingDraft | null {
  const parsed = parseSyntheticLocator(sourceLocator);
  if (!parsed) return null;
  if (parsed.kind === "pivot") {
    const seg = findPivotSegment(region, parsed.segmentId);
    if (!seg) return null;
    return {
      sourceLocator,
      columnDefinitionId: seg.columnDefinitionId ?? null,
      confidence: 1,
      excluded: seg.excluded,
    };
  }
  // cellValueField
  if (!region.cellValueField) return null;
  return {
    sourceLocator,
    columnDefinitionId: region.cellValueField.columnDefinitionId ?? null,
    confidence: 1,
    excluded: region.cellValueField.excluded,
  };
}

/**
 * Source-derived default normalizedKey for a synthetic locator. The
 * locator string itself doesn't carry the underlying name (`pivot:pivot-1`
 * tells you the segment id, not its axisName), so derive from the
 * region's segment / cellValueField slot directly.
 */
function syntheticDerivedNormalizedKey(
  region: RegionDraft,
  sourceLocator: string
): string | undefined {
  const parsed = parseSyntheticLocator(sourceLocator);
  if (!parsed) return undefined;
  if (parsed.kind === "pivot") {
    const seg = findPivotSegment(region, parsed.segmentId);
    return seg ? sourceFieldToNormalizedKey(seg.axisName) : undefined;
  }
  return region.cellValueField
    ? sourceFieldToNormalizedKey(region.cellValueField.name)
    : undefined;
}

export const ReviewStepUI: React.FC<ReviewStepUIProps> = ({
  regions,
  overallConfidence,
  onJumpToRegion,
  onEditBinding,
  onCommit,
  onBack,
  isCommitting = false,
  commitDisabledReason,
  onUpdateBinding,
  onToggleBindingExcluded,
  columnDefinitionSearch,
  resolveReferenceOptions,
  resolveReferenceFieldOptions,
  resolveColumnDefinitionType,
  resolveColumnDefinitionDescription,
  resolveColumnLabel,
}) => {
  const popoverEnabled =
    onUpdateBinding !== undefined &&
    onToggleBindingExcluded !== undefined &&
    columnDefinitionSearch !== undefined;

  const [editing, setEditing] = useState<EditingState | null>(null);

  const handleChipClick = (
    region: RegionDraft,
    sourceLocator: string,
    anchorEl: HTMLElement
  ) => {
    if (!popoverEnabled) {
      onEditBinding(region.id, sourceLocator);
      return;
    }
    const synthetic = parseSyntheticLocator(sourceLocator);
    if (synthetic) {
      // Pivot / cellValueField — synthesize a ColumnBindingDraft from the
      // segment or cellValueField slot. Only `columnDefinitionId` is
      // meaningful (the underlying schema has no override fields), but
      // that's the field the user wants to rebind.
      const baseDraft = syntheticBindingDraft(region, sourceLocator);
      if (!baseDraft) return;
      // Pre-populate the normalizedKey field with the source-derived
      // default so the input shows what the field will be called instead
      // of a blank box. The value is purely cosmetic — handleApply only
      // diffs columnDefinitionId for synthetic locators.
      const derivedKey = syntheticDerivedNormalizedKey(region, sourceLocator);
      const initialDraft: ColumnBindingDraft = {
        ...baseDraft,
        normalizedKey: derivedKey,
      };
      const ctx = draftValidationContext(
        initialDraft,
        resolveColumnDefinitionType
      );
      setEditing({
        regionId: region.id,
        sourceLocator,
        anchorEl,
        draft: initialDraft,
        errors: validateBindingDraft(initialDraft, ctx),
        serverError: null,
      });
      return;
    }
    const binding = region.columnBindings?.find(
      (b) => b.sourceLocator === sourceLocator
    );
    if (!binding) return;
    const ctx = draftValidationContext(binding, resolveColumnDefinitionType);
    // Pre-populate the field with the same derivation commit uses when no
    // override is set, so the user sees the effective default instead of a
    // blank input.
    const derivedNormalizedKey = sourceLocatorToNormalizedKey(sourceLocator);
    const initialDraft = {
      ...binding,
      normalizedKey: binding.normalizedKey ?? derivedNormalizedKey,
    };
    setEditing({
      regionId: region.id,
      sourceLocator,
      anchorEl,
      draft: initialDraft,
      errors: validateBindingDraft(initialDraft, ctx),
      serverError: null,
    });
  };

  const handleDraftChange = (patch: Partial<ColumnBindingDraft>) => {
    setEditing((prev) => {
      if (!prev) return prev;
      const nextDraft = applyBindingDraftPatch(prev.draft, patch);
      const ctx = draftValidationContext(
        nextDraft,
        resolveColumnDefinitionType
      );
      return {
        ...prev,
        draft: nextDraft,
        errors: validateBindingDraft(nextDraft, ctx),
      };
    });
    // Mirror an Omit toggle straight into workflow state so the review-side
    // chip styling updates immediately (and stays in sync if the popover is
    // dismissed). Other patches are held local until Apply.
    if (patch.excluded !== undefined && editing && onToggleBindingExcluded) {
      onToggleBindingExcluded(
        editing.regionId,
        editing.sourceLocator,
        patch.excluded
      );
    }
  };

  const handleApply = () => {
    if (!editing || !onUpdateBinding) return;
    if (Object.keys(editing.errors).length > 0) return;
    // Derive the patch from the diff between the original binding and the
    // draft — `binding` at open-time is the source of truth. We resolve it
    // again from regions in case state mutated underneath us (e.g. Omit
    // toggle already round-tripped through the hook).
    const region = regions.find((r) => r.id === editing.regionId);
    const synthetic = parseSyntheticLocator(editing.sourceLocator);
    if (synthetic) {
      // Pivot / cellValueField slot — only `columnDefinitionId` persists.
      // Override fields (normalizedKey, required, defaultValue, format,
      // enumValues, refEntityKey, refNormalizedKey) have no schema home
      // for these slots and are silently dropped.
      const original = region
        ? syntheticBindingDraft(region, editing.sourceLocator)
        : null;
      if (
        editing.draft.columnDefinitionId !== undefined &&
        editing.draft.columnDefinitionId !== original?.columnDefinitionId
      ) {
        onUpdateBinding(editing.regionId, editing.sourceLocator, {
          columnDefinitionId: editing.draft.columnDefinitionId,
        });
      }
      setEditing(null);
      return;
    }
    const original = region?.columnBindings?.find(
      (b) => b.sourceLocator === editing.sourceLocator
    );
    const patch: Partial<ColumnBindingDraft> = {};
    const keys: Array<keyof ColumnBindingDraft> = [
      "columnDefinitionId",
      "normalizedKey",
      "required",
      "defaultValue",
      "format",
      "enumValues",
      "refEntityKey",
      "refNormalizedKey",
    ];
    const derivedNormalizedKey = sourceLocatorToNormalizedKey(
      editing.sourceLocator
    );
    for (const k of keys) {
      let nextValue = editing.draft[k];
      const prevValue = original?.[k];
      if (k === "normalizedKey") {
        // Empty string or a value equal to the derived default means "no
        // override" — don't persist a spurious override (and revert any
        // prior one by patching to undefined).
        if (nextValue === "" || nextValue === derivedNormalizedKey) {
          nextValue = undefined;
        }
      }
      if (!Object.is(nextValue, prevValue)) {
        (patch as Record<string, unknown>)[k] = nextValue;
      }
    }
    if (Object.keys(patch).length > 0) {
      onUpdateBinding(editing.regionId, editing.sourceLocator, patch);
    }
    setEditing(null);
  };

  const handleCancel = () => setEditing(null);
  const entityOrder = Array.from(
    new Set(
      regions
        .map((r) => r.targetEntityDefinitionId)
        .filter((id): id is string => Boolean(id))
    )
  );

  const entityGroups = entityOrder.map((entityId) => {
    const rs = regions.filter((r) => r.targetEntityDefinitionId === entityId);
    const label = rs[0]?.targetEntityLabel ?? entityId;
    return { entityId, label, regions: rs };
  });

  const allWarnings = regions.flatMap((r) =>
    (r.warnings ?? []).map((w) => ({ regionId: r.id, warning: w }))
  );
  const blockers = allWarnings.filter(
    ({ warning }) => warning.severity === "blocker"
  );
  const hasBlockers = blockers.length > 0;

  // Aggregate binding-level validation errors across all regions. Commit is
  // blocked until the last one is resolved — the in-popover validator mirrors
  // the same rules so users never see the Commit-side message without a
  // matching per-field error on the open popover. The per-region map is
  // also passed to each card so invalid chips render in the error palette.
  const bindingErrorsByRegion = new Map<string, RegionBindingErrors>();
  for (const r of regions) {
    const ctx: Record<string, ReturnType<typeof draftValidationContext>> = {};
    for (const binding of r.columnBindings ?? []) {
      ctx[binding.sourceLocator] = draftValidationContext(
        binding,
        resolveColumnDefinitionType
      );
    }
    const regionErrors = validateRegionBindings(r, ctx);
    if (Object.keys(regionErrors).length > 0) {
      bindingErrorsByRegion.set(r.id, regionErrors);
    }
  }
  const bindingErrorCount = Array.from(
    bindingErrorsByRegion.values()
  ).reduce((sum, regionErrors) => sum + Object.keys(regionErrors).length, 0);
  const bindingDisabledReason =
    bindingErrorCount > 0
      ? `${bindingErrorCount} binding${bindingErrorCount === 1 ? "" : "s"} ha${bindingErrorCount === 1 ? "s" : "ve"} validation errors — fix them before committing.`
      : null;
  const effectiveCommitDisabledReason =
    commitDisabledReason ?? bindingDisabledReason;

  return (
    <Stack spacing={2} sx={{ width: "100%", minWidth: 0 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        spacing={2}
        flexWrap="wrap"
        useFlexGap
      >
        <Stack
          direction="row"
          spacing={1}
          alignItems="baseline"
          flexWrap="wrap"
          useFlexGap
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Review interpretation
          </Typography>
          {overallConfidence !== undefined && (
            <ConfidenceChipUI label="Overall" score={overallConfidence} />
          )}
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button variant="outlined" onClick={onBack}>
            Back to regions
          </Button>
          <Button
            variant="contained"
            onClick={onCommit}
            disabled={
              isCommitting ||
              hasBlockers ||
              Boolean(effectiveCommitDisabledReason)
            }
          >
            {isCommitting ? "Committing…" : "Commit plan"}
          </Button>
        </Stack>
      </Stack>

      {(hasBlockers || effectiveCommitDisabledReason) && (
        <Alert severity="error">
          {effectiveCommitDisabledReason ??
            `${blockers.length} blocker${blockers.length === 1 ? "" : "s"} prevent commit. Resolve below, or cancel and fix the source file.`}
        </Alert>
      )}

      <Stack spacing={2} sx={{ flex: 1, overflow: "auto" }}>
        {entityGroups.map((group) => (
          <Box
            key={group.entityId}
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              p: 2,
            }}
          >
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ mb: 1 }}
            >
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  backgroundColor: colorForEntity(group.entityId, entityOrder),
                }}
              />
              <Typography variant="subtitle2">{group.label}</Typography>
              <Typography variant="caption" color="text.secondary">
                {group.regions.length}{" "}
                {group.regions.length === 1 ? "region" : "regions"}
              </Typography>
            </Stack>

            <Stack spacing={1.5}>
              {group.regions.map((region) => (
                <RegionReviewCardUI
                  key={region.id}
                  region={region}
                  onJump={() => onJumpToRegion(region.id)}
                  onEditBinding={(sourceLocator, anchorEl) =>
                    handleChipClick(region, sourceLocator, anchorEl)
                  }
                  bindingErrors={bindingErrorsByRegion.get(region.id)}
                  resolveColumnLabel={resolveColumnLabel}
                />
              ))}
            </Stack>
          </Box>
        ))}

        {entityGroups.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No regions bound to entities yet.
          </Typography>
        )}
      </Stack>

      {popoverEnabled && editing && (
        <BindingEditorPopoverUI
          open
          anchorEl={editing.anchorEl}
          binding={editing.draft}
          draft={editing.draft}
          titleOverride={(() => {
            const synthetic = parseSyntheticLocator(editing.sourceLocator);
            if (!synthetic) return undefined;
            const region = regions.find((r) => r.id === editing.regionId);
            if (!region) return undefined;
            if (synthetic.kind === "pivot") {
              const seg = findPivotSegment(region, synthetic.segmentId);
              return seg
                ? { primary: seg.axisName, kind: "Pivot axis" }
                : undefined;
            }
            return region.cellValueField
              ? { primary: region.cellValueField.name, kind: "Cell value" }
              : undefined;
          })()}
          derivedNormalizedKey={(() => {
            const region = regions.find((r) => r.id === editing.regionId);
            return region
              ? syntheticDerivedNormalizedKey(region, editing.sourceLocator)
              : undefined;
          })()}
          columnDefinitionType={
            resolveColumnDefinitionType?.(editing.draft) ?? undefined
          }
          columnDefinitionDescription={
            resolveColumnDefinitionDescription?.(editing.draft) ?? undefined
          }
          columnDefinitionSearch={columnDefinitionSearch}
          referenceEntityOptions={(() => {
            const region = regions.find((r) => r.id === editing.regionId);
            return region ? resolveReferenceOptions?.(region) ?? [] : [];
          })()}
          referenceFieldOptions={(() => {
            const region = regions.find((r) => r.id === editing.regionId);
            return region
              ? resolveReferenceFieldOptions?.(
                  region,
                  editing.draft.refEntityKey
                ) ?? []
              : [];
          })()}
          errors={editing.errors}
          serverError={editing.serverError}
          onChange={handleDraftChange}
          onApply={handleApply}
          onCancel={handleCancel}
        />
      )}
    </Stack>
  );
};
