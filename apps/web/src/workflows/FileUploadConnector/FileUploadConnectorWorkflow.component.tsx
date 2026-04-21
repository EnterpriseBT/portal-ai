import React, { useCallback, useMemo, useRef, useState } from "react";

import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

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
import type {
  InterpretRequestBody,
  WorkbookData,
} from "@portalai/core/contracts";

import { UploadStep } from "./UploadStep.component";
import { FileUploadRegionDrawingStepUI } from "./FileUploadRegionDrawingStep.component";
import { FileUploadReviewStepUI } from "./FileUploadReviewStep.component";
import {
  FILE_UPLOAD_WORKFLOW_STEPS,
  useFileUploadWorkflow,
} from "./utils/file-upload-workflow.util";
import type { FileUploadWorkflowCallbacks } from "./utils/file-upload-workflow.util";
import type { UploadPhase } from "./utils/file-upload-fixtures.util";
import {
  entityOptionsFromWorkbook,
  mergeStagedEntityOptions,
  overallConfidenceFromPlan,
  planRegionsToDrafts,
  regionDraftsToHints,
  workbookToBackend,
} from "./utils/layout-plan-mapping.util";

import { sdk, queryKeys } from "../../api/sdk";
import type {
  CellBounds,
  CellValue,
  EntityOption,
  RegionDraft,
  RegionEditorErrors,
  SheetPreview,
  Workbook,
} from "../../modules/RegionEditor";
import type { FileUploadProgress } from "./utils/file-upload-workflow.util";
import type { ServerError } from "../../utils/api.util";

/**
 * Derive the ConnectorInstance name from the first uploaded file. Strips the
 * extension; falls back to `"Upload"` when there are no files or the stripped
 * base is empty.
 */
function deriveConnectorInstanceName(files: File[]): string {
  const filename = files[0]?.name ?? "Upload";
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.substring(0, dot) : filename;
  return base.trim() || "Upload";
}

/**
 * Convert the backend's sparse `WorkbookData` (1-based cell tuples) into the
 * dense `Workbook` the RegionEditor renders. Deterministic sheet ids are
 * minted from the source filename + sheet name so `regionDraftsToHints` can
 * later map them back by name at the interpret boundary.
 */
function backendWorkbookToPreview(
  workbook: WorkbookData,
  sourceLabel: string
): Workbook {
  const sheets: SheetPreview[] = workbook.sheets.map((sheet, idx) => {
    const rows = sheet.dimensions.rows;
    const cols = sheet.dimensions.cols;
    const cells: CellValue[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => "" as CellValue)
    );
    for (const cell of sheet.cells) {
      const r = cell.row - 1;
      const c = cell.col - 1;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      const value = cell.value;
      if (typeof value === "string" || typeof value === "number") {
        cells[r][c] = value;
      } else if (value === null) {
        cells[r][c] = null;
      } else if (value instanceof Date) {
        cells[r][c] = value.toISOString();
      } else if (typeof value === "boolean") {
        cells[r][c] = value ? "TRUE" : "FALSE";
      }
    }
    return {
      id: `sheet_${idx}_${sheet.name.replace(/\s+/g, "_").toLowerCase()}`,
      name: sheet.name,
      rowCount: rows,
      colCount: cols,
      cells,
    };
  });

  return { sheets, sourceLabel };
}

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
  onRegionResize: (regionId: string, nextBounds: CellBounds) => void;
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
  onRegionResize,
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
        defaultMaximized
        maximizable
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
                  onRegionResize={onRegionResize}
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
// Container
// ---------------------------------------------------------------------------

export const FileUploadConnectorWorkflow: React.FC<
  FileUploadConnectorWorkflowProps
> = ({ open, onClose, organizationId, connectorDefinitionId }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { mutateAsync: parseMutate } = sdk.fileUploads.parse();
  const { mutateAsync: interpretMutate } = sdk.layoutPlans.interpret();
  const { mutateAsync: commitMutate } = sdk.layoutPlans.commit();
  const workbookRef = useRef<Workbook | null>(null);
  const filesRef = useRef<File[]>([]);

  // User-staged entities created via the region editor's "+ Create new entity"
  // affordance. Sheet-derived options always win on key collisions; see
  // `mergeStagedEntityOptions`.
  const [stagedEntities, setStagedEntities] = useState<EntityOption[]>([]);

  const handleCreateEntity = useCallback(
    (key: string, label: string): string => {
      setStagedEntities((prev) => {
        if (prev.some((e) => e.value === key)) return prev;
        return [...prev, { value: key, label, source: "staged" as const }];
      });
      return key;
    },
    []
  );

  const parseFile = useCallback(
    async (files: File[]) => {
      if (files.length === 0) throw new Error("No file selected");
      filesRef.current = files;
      const payload = await parseMutate(files);
      const sourceLabel =
        files.length === 1
          ? files[0].name
          : `${files.length} files`;
      const converted = backendWorkbookToPreview(payload.workbook, sourceLabel);
      workbookRef.current = converted;
      return converted;
    },
    [parseMutate]
  );

  const runInterpret: FileUploadWorkflowCallbacks["runInterpret"] = useCallback(
    async (regions) => {
      const workbook = workbookRef.current;
      if (!workbook) throw new Error("Workbook not parsed");
      const body: InterpretRequestBody = {
        workbook: workbookToBackend(workbook),
        regionHints: regionDraftsToHints(workbook, regions),
      };
      const res = await interpretMutate(body);
      return {
        regions: planRegionsToDrafts(res.plan, workbook),
        plan: res.plan,
        overallConfidence: overallConfidenceFromPlan(res.plan),
      };
    },
    [interpretMutate]
  );

  const runCommit: FileUploadWorkflowCallbacks["runCommit"] = useCallback(
    async (plan) => {
      const workbook = workbookRef.current;
      if (!workbook) throw new Error("Workbook not parsed");
      const res = await commitMutate({
        connectorDefinitionId,
        name: deriveConnectorInstanceName(filesRef.current),
        plan,
        workbook: workbookToBackend(workbook),
      });
      await Promise.all(
        [
          queryKeys.connectorInstances.root,
          queryKeys.connectorEntities.root,
          queryKeys.stations.root,
          queryKeys.fieldMappings.root,
          queryKeys.portals.root,
          queryKeys.portalResults.root,
          queryKeys.connectorInstanceLayoutPlans.root,
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey }))
      );
      return { connectorInstanceId: res.connectorInstanceId };
    },
    [commitMutate, connectorDefinitionId, queryClient]
  );

  const workflow = useFileUploadWorkflow({
    parseFile,
    runInterpret,
    runCommit,
    onCommitSuccess: (connectorInstanceId) => {
      navigate({
        to: "/connectors/$connectorInstanceId",
        params: { connectorInstanceId },
      });
      handleClose();
    },
  });

  // The organizationId prop is kept for API symmetry with the previous design
  // but is unused now: the server derives org scope from the authenticated
  // token. Reference it so TypeScript/ESLint don't flag it unused.
  void organizationId;

  const handleClose = useCallback(() => {
    workbookRef.current = null;
    filesRef.current = [];
    setStagedEntities([]);
    workflow.reset();
    onClose();
  }, [workflow, onClose]);

  const entityOptions = useMemo(
    () =>
      mergeStagedEntityOptions(
        entityOptionsFromWorkbook(workflow.workbook),
        stagedEntities
      ),
    [workflow.workbook, stagedEntities]
  );

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
      entityOptions={entityOptions}
      onActiveSheetChange={workflow.onActiveSheetChange}
      onSelectRegion={workflow.onSelectRegion}
      onRegionDraft={workflow.onRegionDraft}
      onRegionUpdate={workflow.onRegionUpdate}
      onRegionResize={(regionId, nextBounds) =>
        workflow.onRegionUpdate(regionId, { bounds: nextBounds })
      }
      onRegionDelete={workflow.onRegionDelete}
      onCreateEntity={handleCreateEntity}
      onInterpret={() => {
        void workflow.onInterpret();
      }}
      overallConfidence={workflow.overallConfidence}
      onJumpToRegion={(regionId) => {
        workflow.onSelectRegion(regionId);
      }}
      onEditBinding={(regionId, _sourceLocator) => {
        // Binding-edit popover not yet wired. Out of scope for this phase —
        // tracked against a follow-up that adds sdk.connectorInstanceLayoutPlans.patch
        // with per-binding mutations. For now, jumping the user to the region
        // on-canvas is the visible affordance.
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
