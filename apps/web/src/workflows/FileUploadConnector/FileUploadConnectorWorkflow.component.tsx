import React, { useCallback, useState } from "react";

import { sdk } from "../../api/sdk";
import type { ConnectorEntityListWithMappingsResponsePayload, ConnectorEntityWithMappings } from "@portalai/core/contracts";

import {
  Box,
  Stack,
  Typography,
  Button,
  Modal,
  Stepper,
  StepPanel,
} from "@portalai/core/ui";
import type { StepConfig, SelectOption } from "@portalai/core/ui";
import type { JobStatus } from "@portalai/core/models";

import { UploadStep } from "./UploadStep.component";
import { EntityStep } from "./EntityStep.component";
import { ColumnMappingStep } from "./ColumnMappingStep.component";
import { ReviewStep } from "./ReviewStep.component";
import {
  useUploadWorkflow,
  WORKFLOW_STEPS,
} from "./utils/upload-workflow.util";
import {
  validateEntityStep,
  validateColumnStep,
  hasEntityStepErrors,
  hasColumnStepErrors,
} from "./utils/file-upload-validation.util";
import type { EntityStepErrors, ColumnStepErrors } from "./utils/file-upload-validation.util";
import { focusFirstInvalidField } from "../../utils/form-validation.util";
import type { ConfirmResponsePayload } from "@portalai/core/contracts";

import type {
  UseUploadWorkflowReturn,
  Recommendations,
  RecommendedEntity,
  RecommendedColumnUpdate,
  ParseSummary,
  WorkflowStep,
} from "./utils/upload-workflow.util";
import type {
  FileUploadProgress,
  UploadPhase,
} from "../../utils/file-upload.util";

// --- UI Props ---

export interface FileUploadConnectorWorkflowUIProps {
  open: boolean;
  onClose: () => void;

  // Stepper state
  step: WorkflowStep;
  stepConfigs: StepConfig[];

  // Upload step
  files: File[];
  onFilesChange: (files: File[]) => void;
  uploadPhase: UploadPhase;
  fileProgress: Map<string, FileUploadProgress>;
  overallUploadPercent: number;
  jobProgress: number;
  jobError: string | null;
  uploadError: string | null;
  isProcessing: boolean;
  connectionStatus: string;
  jobStatus: JobStatus | null;
  jobResult: Record<string, unknown> | null;

  // Entity step
  recommendations: Recommendations | null;
  parseResults: ParseSummary[] | null;
  onUpdateEntity: (index: number, updates: Partial<RecommendedEntity>) => void;
  entityStepErrors?: EntityStepErrors;

  // Column mapping step
  dbEntities: ConnectorEntityWithMappings[];
  isLoadingDbEntities: boolean;
  columnStepErrors?: ColumnStepErrors;
  onUpdateColumn: (
    entityIndex: number,
    columnIndex: number,
    updates: RecommendedColumnUpdate
  ) => void;
  onColumnKeySearch: (query: string) => Promise<SelectOption[]>;
  onColumnKeyGetById: ((id: string) => Promise<SelectOption | null>) | undefined;

  // Review step
  onConnectorNameChange: (name: string) => void;
  onConfirm: () => void;
  isConfirming: boolean;
  confirmError: string | null;
  confirmResult: ConfirmResponsePayload | null;
  onDone: () => void;
  onCancel: () => void;
  isCancelling: boolean;

  // Navigation
  onBack: () => void;
  onNext: () => void;
  backLabel: string;
  nextLabel: string;
  isBackDisabled: boolean;
  isNextDisabled: boolean;
}

// --- Pure UI Component ---

export const FileUploadConnectorWorkflowUI: React.FC<FileUploadConnectorWorkflowUIProps> = ({
  open,
  onClose,
  step,
  stepConfigs,
  files,
  onFilesChange,
  uploadPhase,
  fileProgress,
  overallUploadPercent,
  jobProgress,
  jobError,
  uploadError,
  isProcessing,
  connectionStatus,
  jobStatus,
  jobResult,
  recommendations,
  parseResults,
  onUpdateEntity,
  entityStepErrors,
  dbEntities,
  isLoadingDbEntities,
  columnStepErrors,
  onUpdateColumn,
  onColumnKeySearch,
  onColumnKeyGetById,
  onConnectorNameChange,
  onConfirm,
  isConfirming,
  confirmError,
  confirmResult,
  onDone,
  onCancel,
  isCancelling,
  onBack,
  onNext,
  backLabel,
  nextLabel,
  isBackDisabled,
  isNextDisabled,
}) => {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="File Upload"
      maxWidth="md"
      fullWidth
    >
      <Box sx={{ minHeight: 400 }}>
        <Stepper steps={stepConfigs} activeStep={step}>
          {/* Step 0: Upload CSV */}
          <StepPanel index={0} activeStep={step}>
            <UploadStep
              files={files}
              onFilesChange={onFilesChange}
              uploadPhase={uploadPhase}
              fileProgress={fileProgress}
              overallUploadPercent={overallUploadPercent}
              jobProgress={jobProgress}
              jobError={jobError}
              uploadError={uploadError}
              isProcessing={isProcessing}
              connectionStatus={connectionStatus}
              jobStatus={jobStatus}
              jobResult={jobResult}
            />
          </StepPanel>

          {/* Step 1: Confirm Entities */}
          <StepPanel index={1} activeStep={step}>
            {recommendations ? (
              <EntityStep
                entities={recommendations.entities}
                files={files}
                parseResults={parseResults}
                onUpdateEntity={onUpdateEntity}
                errors={entityStepErrors}
              />
            ) : (
              <Typography color="text.secondary">
                Waiting for recommendations...
              </Typography>
            )}
          </StepPanel>

          {/* Step 2: Map Columns */}
          <StepPanel index={2} activeStep={step}>
            {recommendations ? (
              <ColumnMappingStep
                entities={recommendations.entities}
                dbEntities={dbEntities}
                isLoadingDbEntities={isLoadingDbEntities}
                onUpdateColumn={onUpdateColumn}
                errors={columnStepErrors}
                onColumnKeySearch={onColumnKeySearch}
                onColumnKeyGetById={onColumnKeyGetById}
              />
            ) : (
              <Typography color="text.secondary">
                Waiting for recommendations...
              </Typography>
            )}
          </StepPanel>

          {/* Step 3: Review & Import */}
          <StepPanel index={3} activeStep={step}>
            {recommendations || confirmResult ? (
              <ReviewStep
                recommendations={recommendations}
                onConnectorNameChange={onConnectorNameChange}
                onConfirm={onConfirm}
                isConfirming={isConfirming}
                confirmError={confirmError}
                confirmResult={confirmResult}
                onDone={onDone}
                onCancel={onCancel}
                isCancelling={isCancelling}
              />
            ) : (
              <Typography color="text.secondary">
                No recommendations available.
              </Typography>
            )}
          </StepPanel>
        </Stepper>

        {/* Navigation — hidden on step 3 where ReviewStep has its own actions */}
        {step !== 3 && (
          <Stack
            direction="row"
            justifyContent="space-between"
            sx={{ pt: 2, px: 2 }}
          >
            <Button onClick={onBack} disabled={isBackDisabled} variant="text">
              {backLabel}
            </Button>
            <Button
              onClick={onNext}
              disabled={isNextDisabled}
              variant="contained"
            >
              {nextLabel}
            </Button>
          </Stack>
        )}
      </Box>
    </Modal>
  );
};

// --- Container Props ---

interface FileUploadConnectorWorkflowProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  connectorDefinitionId: string;
}

// --- Helpers ---

function deriveNextLabel(workflow: UseUploadWorkflowReturn): string {
  switch (workflow.step) {
    case 0:
      if (workflow.uploadPhase === "idle" && workflow.files.length > 0)
        return "Upload";
      if (workflow.isProcessing) return "Processing...";
      return "Next";
    case 3:
      return "Confirm";
    default:
      return "Next";
  }
}

function deriveIsNextDisabled(workflow: UseUploadWorkflowReturn): boolean {
  switch (workflow.step) {
    case 0:
      return workflow.files.length === 0 || workflow.isProcessing;
    case 1:
      return (
        !workflow.recommendations ||
        workflow.recommendations.entities.length === 0
      );
    case 2:
      return !workflow.recommendations;
    case 3:
      return false;
    default:
      return false;
  }
}

function deriveStepConfigs(workflow: UseUploadWorkflowReturn): StepConfig[] {
  return WORKFLOW_STEPS.map((s, index) => ({
    label: s.label,
    description: s.description,
    validate: () => {
      switch (index) {
        case 0:
          if (workflow.files.length === 0)
            return "Please select at least one CSV file";
          return true;
        case 1:
          if (
            !workflow.recommendations ||
            workflow.recommendations.entities.length === 0
          )
            return "No entities to review";
          return true;
        default:
          return true;
      }
    },
  }));
}

// --- Container Component ---

export const FileUploadConnectorWorkflow: React.FC<FileUploadConnectorWorkflowProps> = ({
  open,
  onClose,
  organizationId,
  connectorDefinitionId,
}) => {
  const workflow = useUploadWorkflow();
  const [entityStepErrors, setEntityStepErrors] = useState<EntityStepErrors>({});
  const [columnStepErrors, setColumnStepErrors] = useState<ColumnStepErrors>({});
  const { onSearch: onColumnKeySearch, getById: onColumnKeyGetById } = sdk.columnDefinitions.search({
    mapItem: (cd) => ({
      value: cd.id,
      label: `${cd.label} (${cd.key}) — ${cd.type}${cd.description ? ` · ${cd.description}` : ""}`,
      columnDefinition: cd,
    }),
  });

  const { data: dbEntitiesData, isLoading: isLoadingDbEntities } =
    sdk.connectorEntities.list(
      { include: "fieldMappings" } as Parameters<typeof sdk.connectorEntities.list>[0],
      { staleTime: 30_000 }
    );
  const dbEntities: ConnectorEntityWithMappings[] =
    (dbEntitiesData as ConnectorEntityListWithMappingsResponsePayload | undefined)
      ?.connectorEntities ?? [];

  const handleClose = useCallback(() => {
    workflow.reset();
    setEntityStepErrors({});
    setColumnStepErrors({});
    onClose();
  }, [workflow, onClose]);

  const handleStartUpload = useCallback(async () => {
    await workflow.startUpload(organizationId, connectorDefinitionId);
  }, [workflow, organizationId, connectorDefinitionId]);

  const handleNext = useCallback(async () => {
    if (workflow.step === 0 && workflow.uploadPhase === "idle") {
      await handleStartUpload();
      return;
    }

    if (workflow.step === 1 && workflow.recommendations) {
      const errors = validateEntityStep(workflow.recommendations.entities);
      setEntityStepErrors(errors);
      if (hasEntityStepErrors(errors)) {
        requestAnimationFrame(() => focusFirstInvalidField());
        return;
      }
    }

    if (workflow.step === 2 && workflow.recommendations) {
      const errors = validateColumnStep(workflow.recommendations.entities);
      setColumnStepErrors(errors);
      if (hasColumnStepErrors(errors)) {
        requestAnimationFrame(() => focusFirstInvalidField());
        return;
      }
    }

    workflow.goNext();
  }, [workflow, handleStartUpload]);

  const handleBack = useCallback(() => {
    if (workflow.step === 0) {
      handleClose();
    } else {
      workflow.goBack();
    }
  }, [workflow, handleClose]);

  const handleConfirm = useCallback(async () => {
    await workflow.confirm();
  }, [workflow]);

  const handleCancel = useCallback(async () => {
    await workflow.cancel();
    handleClose();
  }, [workflow, handleClose]);

  const stepConfigs = deriveStepConfigs(workflow);

  return (
    <FileUploadConnectorWorkflowUI
      open={open}
      onClose={handleClose}
      step={workflow.step}
      stepConfigs={stepConfigs}
      files={workflow.files}
      onFilesChange={workflow.addFiles}
      uploadPhase={workflow.uploadPhase}
      fileProgress={workflow.uploadProgress}
      overallUploadPercent={workflow.overallUploadPercent}
      jobProgress={workflow.jobProgress}
      jobError={workflow.jobError}
      uploadError={workflow.uploadError}
      isProcessing={workflow.isProcessing}
      connectionStatus={workflow.connectionStatus}
      jobStatus={workflow.jobStatus}
      jobResult={workflow.jobResult}
      recommendations={workflow.recommendations}
      parseResults={workflow.parseResults}
      onUpdateEntity={workflow.updateEntity}
      entityStepErrors={entityStepErrors}
      dbEntities={dbEntities}
      isLoadingDbEntities={isLoadingDbEntities}
      columnStepErrors={columnStepErrors}
      onUpdateColumn={workflow.updateColumn}
      onColumnKeySearch={onColumnKeySearch}
      onColumnKeyGetById={onColumnKeyGetById}
      onConnectorNameChange={workflow.updateConnectorName}
      onConfirm={handleConfirm}
      isConfirming={workflow.isConfirming}
      confirmError={workflow.confirmError}
      confirmResult={workflow.confirmResult}
      onDone={handleClose}
      onCancel={handleCancel}
      isCancelling={workflow.isCancelling}
      onBack={handleBack}
      onNext={handleNext}
      backLabel={workflow.step === 0 ? "Cancel" : "Back"}
      nextLabel={deriveNextLabel(workflow)}
      isBackDisabled={workflow.step === 0 ? false : workflow.isProcessing}
      isNextDisabled={deriveIsNextDisabled(workflow)}
    />
  );
};
