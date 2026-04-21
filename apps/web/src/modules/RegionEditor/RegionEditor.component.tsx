import React from "react";
import { Box, Stack, Stepper, StepPanel } from "@portalai/core/ui";
import type { StepConfig } from "@portalai/core/ui";

import { DriftBannerUI } from "./DriftBanner.component";
import { RegionDrawingStepUI } from "./RegionDrawingStep.component";
import { ReviewStepUI } from "./ReviewStep.component";
import type { LoadSliceFn } from "./SheetCanvas.component";
import type {
  CellBounds,
  DriftReportPreview,
  EntityOption,
  RegionDraft,
  Workbook,
} from "./utils/region-editor.types";
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

  entityOptions: EntityOption[];

  onSuggestAxisName?: (regionId: string) => void;
  onAcceptProposedIdentity?: (regionId: string) => void;
  onKeepPriorIdentity?: (regionId: string) => void;
  onCreateEntity?: (key: string, label: string) => string;

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
  loadSlice?: LoadSliceFn;
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
  onCreateEntity,
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
  loadSlice,
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
            {driftReport && <DriftBannerUI report={driftReport} />}
            <RegionDrawingStepUI
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
              onCreateEntity={onCreateEntity}
              onInterpret={onInterpret}
              onRefetchWorkbook={onRefetchWorkbook}
              isInterpreting={isInterpreting}
              errors={errors}
              loadSlice={loadSlice}
            />
          </Stack>
        </StepPanel>

        <StepPanel index={1} activeStep={step}>
          <ReviewStepUI
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
