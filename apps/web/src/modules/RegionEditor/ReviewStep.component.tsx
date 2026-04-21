import React, { useState } from "react";
import { Box, Stack, Typography, Button } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import Alert from "@mui/material/Alert";
import type { ColumnDataType } from "@portalai/core/models";

import { ConfidenceChipUI } from "./ConfidenceChip.component";
import { RegionReviewCardUI } from "./RegionReviewCard.component";
import { BindingEditorPopoverUI } from "./BindingEditorPopover.component";
import { colorForEntity } from "./utils/region-editor-colors.util";
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
}

interface EditingState {
  regionId: string;
  sourceLocator: string;
  anchorEl: HTMLElement;
  draft: ColumnBindingDraft;
  errors: FormErrors;
  serverError: ServerError | null;
}

const NORMALIZED_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

function validateBindingDraft(draft: ColumnBindingDraft): FormErrors {
  const errors: FormErrors = {};
  if (draft.excluded) return errors;
  if (!draft.columnDefinitionId) {
    errors.columnDefinitionId = "Column definition is required.";
  }
  if (draft.normalizedKey && !NORMALIZED_KEY_PATTERN.test(draft.normalizedKey)) {
    errors.normalizedKey =
      "Must be lowercase snake_case (letters, digits, underscores; start with a letter).";
  }
  return errors;
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
    const binding = region.columnBindings?.find(
      (b) => b.sourceLocator === sourceLocator
    );
    if (!binding) return;
    setEditing({
      regionId: region.id,
      sourceLocator,
      anchorEl,
      draft: { ...binding },
      errors: validateBindingDraft(binding),
      serverError: null,
    });
  };

  const handleDraftChange = (patch: Partial<ColumnBindingDraft>) => {
    setEditing((prev) => {
      if (!prev) return prev;
      const nextDraft = { ...prev.draft, ...patch };
      return {
        ...prev,
        draft: nextDraft,
        errors: validateBindingDraft(nextDraft),
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
    for (const k of keys) {
      const nextValue = editing.draft[k];
      const prevValue = original?.[k];
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
              isCommitting || hasBlockers || Boolean(commitDisabledReason)
            }
          >
            {isCommitting ? "Committing…" : "Commit plan"}
          </Button>
        </Stack>
      </Stack>

      {(hasBlockers || commitDisabledReason) && (
        <Alert severity="error">
          {commitDisabledReason ??
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
