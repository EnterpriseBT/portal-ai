import React, { useCallback } from "react";

import {
  Box,
  Button,
  Modal,
  Stack,
  StepPanel,
  Stepper,
  Typography,
} from "@portalai/core/ui";
import type { StepConfig } from "@portalai/core/ui";

import { UploadStep } from "./UploadStep.component";
import { FileUploadRegionDrawingStepUI } from "./FileUploadRegionDrawingStep.component";
import { FileUploadReviewStepUI } from "./FileUploadReviewStep.component";
import {
  FILE_UPLOAD_WORKFLOW_STEPS,
  useFileUploadWorkflow,
} from "./utils/file-upload-workflow.util";
import type { FileUploadWorkflowCallbacks } from "./utils/file-upload-workflow.util";
import {
  DEMO_WORKBOOK,
  ENTITY_OPTIONS,
  POST_INTERPRET_REGIONS,
} from "./utils/file-upload-fixtures.util";
import type { UploadPhase } from "./utils/file-upload-fixtures.util";

import type {
  CellBounds,
  EntityOption,
  RegionDraft,
  RegionEditorErrors,
  Workbook,
} from "../../modules/RegionEditor";
import type { FileUploadProgress } from "../../utils/file-upload.util";
import type { ServerError } from "../../utils/api.util";

// ---------------------------------------------------------------------------
// UI Props
// ---------------------------------------------------------------------------

export interface FileUploadConnectorWorkflowUIProps {
  open: boolean;
  onClose: () => void;
  step: 0 | 1 | 2;
  stepConfigs: StepConfig[];

  // Upload step
  files: File[];
  onFilesChange: (files: File[]) => void;
  uploadPhase: UploadPhase;
  fileProgress: Map<string, FileUploadProgress>;
  overallUploadPercent: number;
  onStartParse: () => void;

  // Region drawing step
  workbook: Workbook | null;
  regions: RegionDraft[];
  selectedRegionId: string | null;
  activeSheetId: string | null;
  entityOptions: EntityOption[];
  onActiveSheetChange: (sheetId: string) => void;
  onSelectRegion: (regionId: string | null) => void;
  onRegionDraft: (draft: { sheetId: string; bounds: CellBounds }) => void;
  onRegionUpdate: (regionId: string, updates: Partial<RegionDraft>) => void;
  onRegionDelete: (regionId: string) => void;
  onCreateEntity?: (key: string, label: string) => string;
  onInterpret: () => void;

  // Review step
  overallConfidence?: number;
  onJumpToRegion: (regionId: string) => void;
  onEditBinding: (regionId: string, sourceLocator: string) => void;
  onCommit: () => void;

  // Navigation
  onBack: () => void;

  // Status
  errors?: RegionEditorErrors;
  serverError: ServerError | null;
  isInterpreting: boolean;
  isCommitting: boolean;
}

// ---------------------------------------------------------------------------
// Pure UI
// ---------------------------------------------------------------------------

export const FileUploadConnectorWorkflowUI: React.FC<
  FileUploadConnectorWorkflowUIProps
> = ({
  open,
  onClose,
  step,
  stepConfigs,
  files,
  onFilesChange,
  uploadPhase,
  fileProgress,
  overallUploadPercent,
  onStartParse,
  workbook,
  regions,
  selectedRegionId,
  activeSheetId,
  entityOptions,
  onActiveSheetChange,
  onSelectRegion,
  onRegionDraft,
  onRegionUpdate,
  onRegionDelete,
  onCreateEntity,
  onInterpret,
  overallConfidence,
  onJumpToRegion,
  onEditBinding,
  onCommit,
  onBack,
  errors,
  serverError,
  isInterpreting,
  isCommitting,
}) => {
  const isUploadDisabled =
    files.length === 0 ||
    uploadPhase === "uploading" ||
    uploadPhase === "parsing";

  const resolvedActiveSheetId = activeSheetId ?? workbook?.sheets[0]?.id ?? "";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload a spreadsheet"
      maxWidth="lg"
      fullWidth
    >
      <Stack spacing={2} sx={{ minWidth: 0 }}>
        <Stepper steps={stepConfigs} activeStep={step}>
          <StepPanel index={0} activeStep={step}>
            <UploadStep
              files={files}
              onFilesChange={onFilesChange}
              uploadPhase={uploadPhase}
              fileProgress={fileProgress}
              overallUploadPercent={overallUploadPercent}
              serverError={serverError}
            />
          </StepPanel>

          <StepPanel index={1} activeStep={step}>
            {workbook ? (
              <FileUploadRegionDrawingStepUI
                workbook={workbook}
                regions={regions}
                activeSheetId={resolvedActiveSheetId}
                onActiveSheetChange={onActiveSheetChange}
                selectedRegionId={selectedRegionId}
                onSelectRegion={onSelectRegion}
                onRegionDraft={onRegionDraft}
                onRegionUpdate={onRegionUpdate}
                onRegionDelete={onRegionDelete}
                entityOptions={entityOptions}
                onCreateEntity={onCreateEntity}
                onInterpret={onInterpret}
                isInterpreting={isInterpreting}
                errors={errors}
                serverError={serverError}
              />
            ) : (
              <Box sx={{ p: 3 }}>
                <Typography color="text.secondary">
                  Preparing your spreadsheet…
                </Typography>
              </Box>
            )}
          </StepPanel>

          <StepPanel index={2} activeStep={step}>
            <FileUploadReviewStepUI
              regions={regions}
              overallConfidence={overallConfidence}
              onJumpToRegion={onJumpToRegion}
              onEditBinding={onEditBinding}
              onCommit={onCommit}
              onBack={onBack}
              isCommitting={isCommitting}
              serverError={serverError}
            />
          </StepPanel>
        </Stepper>

        {step === 0 && (
          <Stack direction="row" justifyContent="space-between" sx={{ pt: 1 }}>
            <Button variant="text" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={onStartParse}
              disabled={isUploadDisabled}
            >
              Upload
            </Button>
          </Stack>
        )}

        {step === 1 && (
          <Stack direction="row" justifyContent="flex-start" sx={{ pt: 1 }}>
            <Button variant="text" onClick={onBack}>
              Back
            </Button>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Container Props
// ---------------------------------------------------------------------------

interface FileUploadConnectorWorkflowProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  connectorDefinitionId: string;
}

// ---------------------------------------------------------------------------
// Stub async callbacks — follow-up PR replaces each with a real SDK call.
//
// See docs/SPREADSHEET_PARSING.frontend.plan.md §Phase 6 for the hand-off
// contract. Each stub below is anchored with `TODO(API wiring):` so the
// replacement PR can grep them in one pass.
// ---------------------------------------------------------------------------

/**
 * TODO(API wiring): upload + parse files into a `Workbook`.
 *
 * Backend endpoint: `POST /api/file-uploads/parse` (to be added — not in
 *   `SPREADSHEET_PARSING.backend.spec.md` yet; track as an open item and
 *   define the request body to accept multipart files, response body to
 *   return a `Workbook` matching `modules/RegionEditor/utils/region-editor.types.ts`).
 * SDK method: `sdk.fileUploads.parse(files, options)` — add to
 *   `apps/web/src/api/` (new `file-uploads.api.ts`) and re-export via
 *   `api/sdk.ts`.
 * Cache invalidation: none. Parse output is ephemeral and consumed
 *   in-memory by the region editor; it is never cached in TanStack Query.
 */
function stubParseFile(_files: File[]): Promise<Workbook> {
  return new Promise((resolve) =>
    setTimeout(() => resolve(DEMO_WORKBOOK), 300)
  );
}

/**
 * TODO(API wiring): run the interpreter against the current region drafts.
 *
 * Backend endpoint: `POST /api/connector-instances/:id/layout-plan/interpret`
 *   (see `SPREADSHEET_PARSING.backend.spec.md` §Sync integration).
 * SDK method: `sdk.connectorInstanceLayoutPlans.interpret(connectorInstanceId,
 *   { workbook, regionHints })`. Add a new `connector-instance-layout-plans.api.ts`
 *   module and re-export from `api/sdk.ts`.
 * Query keys to add in `api/keys.ts` (re-exported from `api/sdk.ts`):
 *   - `connectorInstanceLayoutPlans.root`
 *   - `connectorInstanceLayoutPlans.detail(connectorInstanceId)`
 * Cache invalidation on success:
 *   - `connectorInstanceLayoutPlans.root`
 *
 * The backend persists the plan with `supersededBy: null` and returns the
 * plan plus `interpretationTrace`; this callback maps that payload back into
 * the shape the `useFileUploadWorkflow` hook expects
 * (`{ regions: RegionDraft[], overallConfidence: number }`).
 */
function stubRunInterpret(
  _regions: RegionDraft[]
): Promise<{ regions: RegionDraft[]; overallConfidence: number }> {
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({ regions: POST_INTERPRET_REGIONS, overallConfidence: 0.86 }),
      300
    )
  );
}

/**
 * TODO(API wiring): commit the reviewed plan.
 *
 * Backend endpoint: `POST /api/connector-instances/:id/layout-plan/:planId/commit`
 *   (see `SPREADSHEET_PARSING.backend.spec.md` §Sync integration). Loads the
 *   adapted workbook, calls `replay(plan, workbook)`, writes `entity_records`,
 *   and links the sync history row to `layout_plan_id`.
 * SDK method: `sdk.connectorInstanceLayoutPlans.commit(connectorInstanceId,
 *   planId)` (same module added for interpret).
 * Cache invalidation on success (per `CLAUDE.md` §Mutation Cache Invalidation
 *   — a commit is a cascade across the connector's downstream entities):
 *   - `connectorInstances.root`
 *   - `connectorEntities.root`
 *   - `stations.root`
 *   - `fieldMappings.root`
 *   - `portals.root`
 *   - `portalResults.root`
 *   - `connectorInstanceLayoutPlans.root`
 *
 * Drift-gated failures return `409` with a `DriftReport`; the replacement
 * wiring must surface that via `toServerError(...)` so
 * `FileUploadReviewStepUI` renders it in its `<FormAlert>`.
 */
function stubRunCommit(
  _regions: RegionDraft[]
): Promise<{ connectorInstanceId: string }> {
  return new Promise((resolve) =>
    setTimeout(() => resolve({ connectorInstanceId: "ci_demo" }), 300)
  );
}

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

export const FileUploadConnectorWorkflow: React.FC<
  FileUploadConnectorWorkflowProps
> = ({ open, onClose, organizationId, connectorDefinitionId }) => {
  // TODO(API wiring): `organizationId` + `connectorDefinitionId` are the scope
  // for the upcoming stubs. `parseFile` / `runInterpret` / `runCommit` call
  // sites will pass them through as path/body params once real SDK mutations
  // land. Kept in the signature today so the callsite in Connector.view.tsx
  // stays stable.
  void organizationId;
  void connectorDefinitionId;

  const callbacks: FileUploadWorkflowCallbacks = {
    parseFile: stubParseFile,
    runInterpret: stubRunInterpret,
    runCommit: stubRunCommit,
    onCommitSuccess: (connectorInstanceId) => {
      // TODO(API wiring): navigate to the connector instance detail view via
      // TanStack Router (e.g. `navigate({ to: "/connectors/$id", params: { id: connectorInstanceId } })`)
      // and close the modal. For now we only close — the fake commit id
      // (`"ci_demo"`) is not yet a routable resource.
      void connectorInstanceId;
      handleClose();
    },
  };

  const workflow = useFileUploadWorkflow(callbacks);

  const handleClose = useCallback(() => {
    workflow.reset();
    onClose();
  }, [workflow, onClose]);

  return (
    <FileUploadConnectorWorkflowUI
      open={open}
      onClose={handleClose}
      step={workflow.step}
      stepConfigs={FILE_UPLOAD_WORKFLOW_STEPS}
      files={workflow.files}
      onFilesChange={workflow.addFiles}
      uploadPhase={workflow.uploadPhase}
      fileProgress={workflow.fileProgress}
      overallUploadPercent={workflow.overallUploadPercent}
      onStartParse={() => {
        void workflow.startParse();
      }}
      workbook={workflow.workbook}
      regions={workflow.regions}
      selectedRegionId={workflow.selectedRegionId}
      activeSheetId={workflow.activeSheetId}
      entityOptions={ENTITY_OPTIONS}
      onActiveSheetChange={workflow.onActiveSheetChange}
      onSelectRegion={workflow.onSelectRegion}
      onRegionDraft={workflow.onRegionDraft}
      onRegionUpdate={workflow.onRegionUpdate}
      onRegionDelete={workflow.onRegionDelete}
      onInterpret={() => {
        void workflow.onInterpret();
      }}
      overallConfidence={workflow.overallConfidence}
      onJumpToRegion={(regionId) => {
        workflow.onSelectRegion(regionId);
      }}
      onEditBinding={(regionId, _sourceLocator) => {
        // TODO(API wiring): open the binding-edit popover against the shared
        // RegionEditor's column-binding mutation. Edit is a local plan-state
        // change (the interpreter already ran); on confirm the bound
        // container calls `sdk.connectorInstanceLayoutPlans.updateBinding`
        // (to be added under the same module as interpret/commit) and
        // invalidates `connectorInstanceLayoutPlans.detail(connectorInstanceId)`.
        // For now, jumping the user to the region on-canvas is the placeholder.
        workflow.onSelectRegion(regionId);
      }}
      onCommit={() => {
        void workflow.onCommit();
      }}
      onBack={workflow.goBack}
      serverError={workflow.serverError}
      isInterpreting={workflow.isInterpreting}
      isCommitting={workflow.isCommitting}
    />
  );
};
