import React from "react";
import { Box, Stack, Stepper, StepPanel } from "@portalai/core/ui";
import type { StepConfig } from "@portalai/core/ui";

import { DriftBannerUI } from "./DriftBanner.component";
import { RegionDrawingStepUI } from "./RegionDrawingStep.component";
import { ReviewStepUI } from "./ReviewStep.component";
import type { LoadSliceFn } from "./SheetCanvas.component";
import type { LocatorOption } from "./utils/identity-locator-options.util";
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

  onAcceptProposedIdentity?: (regionId: string) => void;
  onKeepPriorIdentity?: (regionId: string) => void;
  onCreateEntity?: (key: string, label: string) => string;
  /**
   * Forwarded to `RegionConfigurationPanelUI` (via
   * `RegionDrawingStepUI`). Locks the Target-Entity Select + Label
   * TextField and hides "+ Create new entity" — used by the edit-plan
   * view so post-commit edits can change region shape + extent rules
   * but not which entity a region populates.
   */
  entityAssociationLocked?: boolean;
  /**
   * Forwarded to `RegionConfigurationPanelUI` and the keyboard handler
   * in `RegionDrawingStepUI`. The edit-plan view sets this so a
   * persisted region can't be deleted from the config panel or via
   * Delete/Backspace.
   */
  regionDeletionLocked?: boolean;

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
  /**
   * Per-region IdentityPanel dropdown options. Forwarded verbatim to
   * `ReviewStepUI`. When omitted the panel hides (default for callers
   * that don't yet wire identity editing — sandbox stories, legacy
   * harnesses). Workflows + the edit-plan view should pass this so
   * the Label field on the identity panel resolves to the picked
   * column's header text.
   */
  resolveIdentityLocatorOptions?: (
    region: RegionDraft
  ) => LocatorOption[] | undefined;
  /** Fires when the user picks an identity option in the panel. */
  onIdentityUpdate?: (
    regionId: string,
    change:
      | { kind: "column"; locator: { axis: "row" | "column"; index: number } }
      | { kind: "rowPosition" }
  ) => void;
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
  onAcceptProposedIdentity,
  onKeepPriorIdentity,
  onCreateEntity,
  entityAssociationLocked,
  regionDeletionLocked,
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
  resolveIdentityLocatorOptions,
  onIdentityUpdate,
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
              onAcceptProposedIdentity={onAcceptProposedIdentity}
              onKeepPriorIdentity={onKeepPriorIdentity}
              onCreateEntity={onCreateEntity}
              entityAssociationLocked={entityAssociationLocked}
              regionDeletionLocked={regionDeletionLocked}
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
            resolveIdentityLocatorOptions={resolveIdentityLocatorOptions}
            onIdentityUpdate={onIdentityUpdate}
          />
        </StepPanel>
      </Stepper>
    </Box>
  );
};
