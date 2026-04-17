import React from "react";
import { Box, Stack, Typography, Button, Divider } from "@portalai/core/ui";
import Alert from "@mui/material/Alert";

import { formatBounds } from "./utils/a1-notation.util";
import { colorForEntity, confidenceBand, CONFIDENCE_BAND_COLOR } from "./utils/region-editor-colors.util";
import type { RegionDraft, RegionWarning } from "./utils/region-editor.types";

export interface ReviewStepProps {
  regions: RegionDraft[];
  overallConfidence?: number;
  onJumpToRegion: (regionId: string) => void;
  onEditBinding: (regionId: string, sourceLocator: string) => void;
  onCommit: () => void;
  onBack: () => void;
  isCommitting?: boolean;
  commitDisabledReason?: string | null;
}

export const ReviewStep: React.FC<ReviewStepProps> = ({
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
    new Set(regions.map((r) => r.targetEntityDefinitionId).filter((id): id is string => Boolean(id)))
  );

  const entityGroups = entityOrder.map((entityId) => {
    const rs = regions.filter((r) => r.targetEntityDefinitionId === entityId);
    const label = rs[0]?.targetEntityLabel ?? entityId;
    return { entityId, label, regions: rs };
  });

  const allWarnings = regions.flatMap((r) =>
    (r.warnings ?? []).map((w) => ({ regionId: r.id, warning: w }))
  );
  const blockers = allWarnings.filter(({ warning }) => warning.severity === "blocker");
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
        <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap" useFlexGap>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Review interpretation
          </Typography>
          {overallConfidence !== undefined && (
            <ConfidenceChip label="Overall" score={overallConfidence} />
          )}
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button variant="outlined" onClick={onBack}>
            Back to regions
          </Button>
          <Button
            variant="contained"
            onClick={onCommit}
            disabled={isCommitting || hasBlockers || Boolean(commitDisabledReason)}
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
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
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
                {group.regions.length} {group.regions.length === 1 ? "region" : "regions"}
              </Typography>
            </Stack>

            <Stack spacing={1.5}>
              {group.regions.map((region) => (
                <RegionReviewCard
                  key={region.id}
                  region={region}
                  onJump={() => onJumpToRegion(region.id)}
                  onEditBinding={(sourceLocator) => onEditBinding(region.id, sourceLocator)}
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

interface RegionReviewCardProps {
  region: RegionDraft;
  onJump: () => void;
  onEditBinding: (sourceLocator: string) => void;
}

const RegionReviewCard: React.FC<RegionReviewCardProps> = ({
  region,
  onJump,
  onEditBinding,
}) => {
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
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {region.proposedLabel ?? formatBounds(region.bounds)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatBounds(region.bounds)}
          </Typography>
          <ConfidenceChip label="Region" score={region.confidence} />
        </Stack>
        <Button size="small" variant="text" onClick={onJump}>
          Jump to region
        </Button>
      </Stack>

      {region.columnBindings && region.columnBindings.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {region.columnBindings.map((binding) => {
              const band = confidenceBand(binding.confidence);
              return (
                <Box
                  key={binding.sourceLocator}
                  onClick={() => onEditBinding(binding.sourceLocator)}
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 0.5,
                    px: 1,
                    py: 0.25,
                    borderRadius: 16,
                    border: "1px solid",
                    borderColor: CONFIDENCE_BAND_COLOR[band],
                    backgroundColor: "background.paper",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {binding.sourceLocator}
                  </Typography>
                  <span>→</span>
                  <Typography variant="caption">
                    {binding.columnDefinitionLabel ?? binding.columnDefinitionId ?? "—"}
                  </Typography>
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      backgroundColor: CONFIDENCE_BAND_COLOR[band],
                    }}
                  />
                </Box>
              );
            })}
          </Stack>
        </>
      )}

      {region.warnings && region.warnings.length > 0 && (
        <Stack spacing={0.75} sx={{ mt: 1 }}>
          {region.warnings.map((w, i) => (
            <WarningRow key={i} warning={w} onJump={onJump} />
          ))}
        </Stack>
      )}
    </Box>
  );
};

const WarningRow: React.FC<{ warning: RegionWarning; onJump: () => void }> = ({
  warning,
  onJump,
}) => {
  const severityMap: Record<RegionWarning["severity"], "info" | "warning" | "error"> = {
    info: "info",
    warn: "warning",
    blocker: "error",
  };
  return (
    <Alert
      severity={severityMap[warning.severity]}
      action={
        <Button size="small" onClick={onJump}>
          Jump
        </Button>
      }
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {warning.code}
      </Typography>
      <Typography variant="caption" sx={{ display: "block" }}>
        {warning.message}
      </Typography>
      {warning.suggestedFix && (
        <Typography variant="caption" sx={{ display: "block", fontStyle: "italic" }}>
          Suggested fix: {warning.suggestedFix}
        </Typography>
      )}
    </Alert>
  );
};

interface ConfidenceChipProps {
  label: string;
  score?: number;
}

const ConfidenceChip: React.FC<ConfidenceChipProps> = ({ label, score }) => {
  const band = confidenceBand(score);
  if (band === "none") return null;
  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        px: 0.75,
        py: 0.125,
        borderRadius: 8,
        backgroundColor: `${CONFIDENCE_BAND_COLOR[band]}1A`,
        border: "1px solid",
        borderColor: CONFIDENCE_BAND_COLOR[band],
        fontSize: 11,
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography variant="caption">
        {score !== undefined ? `${Math.round(score * 100)}%` : "—"}
      </Typography>
    </Box>
  );
};
