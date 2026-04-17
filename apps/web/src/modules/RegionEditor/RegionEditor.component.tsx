import React from "react";
import { Box, Stack, Stepper, StepPanel } from "@portalai/core/ui";
import type { StepConfig, SelectOption } from "@portalai/core/ui";

import { RegionDrawingStep } from "./RegionDrawingStep.component";
import { ReviewStep } from "./ReviewStep.component";
import type { CellBounds, DriftReportPreview, RegionDraft, Workbook } from "./utils/region-editor.types";
import type { RegionEditorErrors } from "./utils/region-editor-validation.util";

export type RegionEditorStep = 0 | 1;

export interface RegionEditorUIProps {
  step: RegionEditorStep;
  stepConfigs: StepConfig[];
  workbook: Workbook;

  regions: RegionDraft[];
  activeSheetId: string;
  onActiveSheetChange: (sheetId: string) => void;

  selectedRegionId: string | null;
  onSelectRegion: (regionId: string | null) => void;
  onRegionDraft: (draft: { sheetId: string; bounds: CellBounds }) => void;
  onRegionUpdate: (regionId: string, updates: Partial<RegionDraft>) => void;
  onRegionDelete: (regionId: string) => void;
  onRegionResize?: (regionId: string, nextBounds: CellBounds) => void;

  entityOptions: SelectOption[];

  onSuggestAxisName?: (regionId: string) => void;
  onAcceptProposedIdentity?: (regionId: string) => void;
  onKeepPriorIdentity?: (regionId: string) => void;

  onInterpret: () => void;
  isInterpreting?: boolean;
  onRefetchWorkbook?: () => void;

  overallConfidence?: number;
  onJumpToRegion: (regionId: string) => void;
  onEditBinding: (regionId: string, sourceLocator: string) => void;
  onCommit: () => void;
  onBack: () => void;
  isCommitting?: boolean;
  commitDisabledReason?: string | null;

  driftReport?: DriftReportPreview | null;
  errors?: RegionEditorErrors;
}

export const RegionEditorUI: React.FC<RegionEditorUIProps> = ({
  step,
  stepConfigs,
  workbook,
  regions,
  activeSheetId,
  onActiveSheetChange,
  selectedRegionId,
  onSelectRegion,
  onRegionDraft,
  onRegionUpdate,
  onRegionDelete,
  onRegionResize,
  entityOptions,
  onSuggestAxisName,
  onAcceptProposedIdentity,
  onKeepPriorIdentity,
  onInterpret,
  isInterpreting,
  onRefetchWorkbook,
  overallConfidence,
  onJumpToRegion,
  onEditBinding,
  onCommit,
  onBack,
  isCommitting,
  commitDisabledReason,
  driftReport,
  errors,
}) => {
  return (
    <Box
      sx={{
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Stepper steps={stepConfigs} activeStep={step}>
        <StepPanel index={0} activeStep={step}>
          <Stack spacing={2}>
            {driftReport && (
              <DriftBanner report={driftReport} />
            )}
            <RegionDrawingStep
              workbook={workbook}
              regions={regions}
              activeSheetId={activeSheetId}
              onActiveSheetChange={onActiveSheetChange}
              selectedRegionId={selectedRegionId}
              onSelectRegion={onSelectRegion}
              onRegionDraft={onRegionDraft}
              onRegionUpdate={onRegionUpdate}
              onRegionDelete={onRegionDelete}
              onRegionResize={onRegionResize}
              entityOptions={entityOptions}
              onSuggestAxisName={onSuggestAxisName}
              onAcceptProposedIdentity={onAcceptProposedIdentity}
              onKeepPriorIdentity={onKeepPriorIdentity}
              onInterpret={onInterpret}
              onRefetchWorkbook={onRefetchWorkbook}
              isInterpreting={isInterpreting}
              errors={errors}
            />
          </Stack>
        </StepPanel>

        <StepPanel index={1} activeStep={step}>
          <ReviewStep
            regions={regions}
            overallConfidence={overallConfidence}
            onJumpToRegion={onJumpToRegion}
            onEditBinding={onEditBinding}
            onCommit={onCommit}
            onBack={onBack}
            isCommitting={isCommitting}
            commitDisabledReason={commitDisabledReason}
          />
        </StepPanel>
      </Stepper>
    </Box>
  );
};

const DriftBanner: React.FC<{ report: DriftReportPreview }> = ({ report }) => {
  const severityColor =
    report.severity === "blocker"
      ? "error.main"
      : report.severity === "warn"
        ? "warning.main"
        : "info.main";
  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 1,
        border: "1px solid",
        borderColor: severityColor,
        backgroundColor: `${report.severity === "blocker" ? "#fee2e2" : "#fef3c7"}`,
      }}
    >
      <Box sx={{ fontWeight: 600, mb: 0.5 }}>
        Drift halted sync {report.identityChanging ? "— identity changing" : ""}
      </Box>
      <Box sx={{ fontSize: 12, color: "text.secondary" }}>
        Workbook pinned as of {report.fetchedAt}. Editing against the same data the sync saw.
      </Box>
      {report.notes && <Box sx={{ fontSize: 12, mt: 0.5 }}>{report.notes}</Box>}
    </Box>
  );
};
