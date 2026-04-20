import React from "react";
import { Box, Stack, Typography, Button } from "@portalai/core/ui";
import Alert from "@mui/material/Alert";

import { ConfidenceChipUI } from "./ConfidenceChip.component";
import { RegionReviewCardUI } from "./RegionReviewCard.component";
import { colorForEntity } from "./utils/region-editor-colors.util";
import type { RegionDraft } from "./utils/region-editor.types";

export interface ReviewStepUIProps {
  regions: RegionDraft[];
  overallConfidence?: number;
  onJumpToRegion: (regionId: string) => void;
  onEditBinding: (regionId: string, sourceLocator: string) => void;
  onCommit: () => void;
  onBack: () => void;
  isCommitting?: boolean;
  commitDisabledReason?: string | null;
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
}) => {
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
                  onEditBinding={(sourceLocator) =>
                    onEditBinding(region.id, sourceLocator)
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
    </Stack>
  );
};
