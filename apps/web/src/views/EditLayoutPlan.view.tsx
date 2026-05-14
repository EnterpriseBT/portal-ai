import React, { useCallback, useMemo, useState } from "react";

import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { Box, Button, Stack, Typography } from "@portalai/core/ui";
import type { StepConfig } from "@portalai/core/ui";
import Alert from "@mui/material/Alert";

import type {
  LayoutPlanEditContextResponsePayload,
  LayoutPlanEditContextWorkbookPreview,
} from "@portalai/core/contracts";

import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";
import { FormAlert } from "../components/FormAlert.component";
import { RegionEditorUI } from "../modules/RegionEditor";
import type {
  CellBounds,
  EntityOption,
  RegionDraft,
  Workbook,
} from "../modules/RegionEditor";
import { planRegionsToDrafts } from "../workflows/FileUploadConnector/utils/layout-plan-mapping.util";

const STEP_CONFIGS: StepConfig[] = [
  { label: "Draw regions", description: "Outline the data on each sheet" },
  { label: "Review", description: "Confirm bindings and recommit" },
];

/**
 * Convert the backend's preview envelope (`{ id, name, dimensions, cells }`)
 * into the editor's `Workbook` shape (`{ sheets: [{ id, name, rowCount,
 * colCount, cells }] }`). The dimensions key flattening is the only
 * meaningful translation; cell values come through unchanged.
 */
function previewToEditorWorkbook(
  preview: LayoutPlanEditContextWorkbookPreview
): Workbook {
  return {
    sheets: preview.sheets.map((sheet) => ({
      id: sheet.id,
      name: sheet.name,
      rowCount: sheet.dimensions.rows,
      colCount: sheet.dimensions.cols,
      cells: sheet.cells,
    })),
  };
}

// ── UI (pure) ────────────────────────────────────────────────────────────

export interface EditLayoutPlanViewUIProps {
  /** Current edit-context payload, or `null` while the query is loading. */
  editContext: LayoutPlanEditContextResponsePayload | null;
  loading: boolean;
  loadError: ReturnType<typeof toServerError>;
  commitError: ReturnType<typeof toServerError>;
  isCommitting: boolean;

  // Editor state (only meaningful when editContext.editable is true).
  regions: RegionDraft[];
  activeSheetId: string;
  selectedRegionId: string | null;
  step: 0 | 1;

  // Editor callbacks — all close over local container state.
  onActiveSheetChange: (sheetId: string) => void;
  onSelectRegion: (id: string | null) => void;
  onRegionDraft: (draft: { sheetId: string; bounds: CellBounds }) => void;
  onRegionUpdate: (regionId: string, updates: Partial<RegionDraft>) => void;
  onRegionDelete: (regionId: string) => void;
  onRegionResize: (regionId: string, nextBounds: CellBounds) => void;
  onJumpToRegion: (regionId: string) => void;
  onEditBinding: (regionId: string, sourceLocator: string) => void;
  onCommit: () => void;
  onBack: () => void;
}

export const EditLayoutPlanViewUI: React.FC<EditLayoutPlanViewUIProps> = ({
  editContext,
  loading,
  loadError,
  commitError,
  isCommitting,
  regions,
  activeSheetId,
  selectedRegionId,
  step,
  onActiveSheetChange,
  onSelectRegion,
  onRegionDraft,
  onRegionUpdate,
  onRegionDelete,
  onRegionResize,
  onJumpToRegion,
  onEditBinding,
  onCommit,
  onBack,
}) => {
  if (loading) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography>Loading layout plan…</Typography>
      </Box>
    );
  }
  if (loadError) {
    return (
      <Box sx={{ p: 4 }}>
        <FormAlert serverError={loadError} />
        <Box sx={{ mt: 2 }}>
          <Button onClick={onBack} variant="outlined">
            Back
          </Button>
        </Box>
      </Box>
    );
  }
  if (!editContext) return null;

  if (!editContext.editable) {
    return (
      <Box sx={{ p: 4, maxWidth: 720 }}>
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography component="div" sx={{ fontWeight: 500, mb: 0.5 }}>
            This layout plan can&rsquo;t be edited.
          </Typography>
          <Typography component="div">
            {editContext.reason?.message ??
              "The workbook source for this connector is no longer available."}
          </Typography>
        </Alert>
        <Stack direction="row" spacing={1}>
          <Button
            href="/connectors/new/file-upload"
            data-testid="reupload-link"
            variant="contained"
          >
            Re-upload to create a new connector
          </Button>
          <Button onClick={onBack} variant="outlined">
            Back
          </Button>
        </Stack>
      </Box>
    );
  }

  const workbook = previewToEditorWorkbook(editContext.workbookPreview!);
  const entityOptions: EntityOption[] = []; // Slice 3 deferral: full entity catalog wiring belongs in 3b.

  return (
    <Box sx={{ width: "100%", height: "100%" }}>
      {commitError ? (
        <Box sx={{ px: 2, pt: 2 }}>
          <FormAlert serverError={commitError} />
        </Box>
      ) : null}
      <RegionEditorUI
        step={step}
        stepConfigs={STEP_CONFIGS}
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
        // Edit mode does not re-run interpret — Save Draft is deferred to
        // slice 3b; for now the interpret button is a no-op.
        onInterpret={() => undefined}
        onJumpToRegion={onJumpToRegion}
        onEditBinding={onEditBinding}
        onCommit={onCommit}
        onBack={onBack}
        isCommitting={isCommitting}
      />
    </Box>
  );
};

// ── Container ────────────────────────────────────────────────────────────

export interface EditLayoutPlanViewProps {
  connectorInstanceId: string;
}

export const EditLayoutPlanView: React.FC<EditLayoutPlanViewProps> = ({
  connectorInstanceId,
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const editContextQuery =
    sdk.connectorInstanceLayoutPlans.getEditContext(connectorInstanceId);
  const editContext = editContextQuery.data ?? null;

  const { mutateAsync: recommitMutate, isPending: isCommitting, error: commitMutationError } =
    sdk.connectorInstanceLayoutPlans.commit(
      connectorInstanceId,
      editContext?.planId ?? ""
    );

  // Local editor state — initialized from the edit-context plan and the
  // preview workbook on first render after the query resolves.
  const [regions, setRegions] = useState<RegionDraft[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string>("");
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [step, setStep] = useState<0 | 1>(0);
  const [hydratedFromContextId, setHydratedFromContextId] = useState<
    string | null
  >(null);

  // Hydrate local state once the editable payload arrives.
  React.useEffect(() => {
    if (!editContext?.editable || !editContext.workbookPreview) return;
    if (hydratedFromContextId === editContext.planId) return;
    const workbook = previewToEditorWorkbook(editContext.workbookPreview);
    setRegions(
      planRegionsToDrafts(editContext.plan, workbook)
    );
    if (workbook.sheets[0]) setActiveSheetId(workbook.sheets[0].id);
    setHydratedFromContextId(editContext.planId);
  }, [editContext, hydratedFromContextId]);

  const handleRegionDraft = useCallback(
    (draft: { sheetId: string; bounds: CellBounds }) => {
      const id = `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setRegions((prev) => [
        ...prev,
        {
          id,
          sheetId: draft.sheetId,
          bounds: draft.bounds,
          headerAxes: ["row"],
          targetEntityDefinitionId: null,
          columnBindings: [],
        },
      ]);
      setSelectedRegionId(id);
    },
    []
  );

  const handleRegionUpdate = useCallback(
    (regionId: string, updates: Partial<RegionDraft>) => {
      setRegions((prev) =>
        prev.map((r) => (r.id === regionId ? { ...r, ...updates } : r))
      );
    },
    []
  );

  const handleRegionDelete = useCallback((regionId: string) => {
    setRegions((prev) => prev.filter((r) => r.id !== regionId));
    setSelectedRegionId((sel) => (sel === regionId ? null : sel));
  }, []);

  const handleRegionResize = useCallback(
    (regionId: string, nextBounds: CellBounds) => {
      setRegions((prev) =>
        prev.map((r) => (r.id === regionId ? { ...r, bounds: nextBounds } : r))
      );
    },
    []
  );

  const handleCommit = useCallback(async () => {
    if (!editContext?.editable) return;
    try {
      await recommitMutate({});
      await queryClient.invalidateQueries({
        queryKey: queryKeys.connectorInstances.root,
      });
      navigate({
        to: "/connectors/$connectorInstanceId",
        params: { connectorInstanceId },
      });
    } catch {
      // Mutation error is surfaced via `commitMutationError` → FormAlert.
      // Stay on the page so the user can fix the plan and retry.
    }
  }, [
    editContext?.editable,
    recommitMutate,
    queryClient,
    navigate,
    connectorInstanceId,
  ]);

  const handleBack = useCallback(() => {
    navigate({
      to: "/connectors/$connectorInstanceId",
      params: { connectorInstanceId },
    });
  }, [navigate, connectorInstanceId]);

  const loadError = useMemo(
    () => toServerError(editContextQuery.error),
    [editContextQuery.error]
  );
  const commitError = useMemo(
    () => toServerError(commitMutationError),
    [commitMutationError]
  );

  return (
    <EditLayoutPlanViewUI
      editContext={editContext}
      loading={editContextQuery.isLoading}
      loadError={loadError}
      commitError={commitError}
      isCommitting={isCommitting}
      regions={regions}
      activeSheetId={activeSheetId}
      selectedRegionId={selectedRegionId}
      step={step}
      onActiveSheetChange={setActiveSheetId}
      onSelectRegion={setSelectedRegionId}
      onRegionDraft={handleRegionDraft}
      onRegionUpdate={handleRegionUpdate}
      onRegionDelete={handleRegionDelete}
      onRegionResize={handleRegionResize}
      onJumpToRegion={(id) => {
        setSelectedRegionId(id);
        setStep(0);
      }}
      onEditBinding={() => undefined}
      onCommit={handleCommit}
      onBack={handleBack}
    />
  );
};
