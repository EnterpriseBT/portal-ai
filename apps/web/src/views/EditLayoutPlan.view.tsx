import React, { useCallback, useMemo, useState } from "react";

import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import {
  Box,
  Button,
  Icon,
  IconName,
  PageHeader,
  Stack,
  Typography,
} from "@portalai/core/ui";
import type { StepConfig } from "@portalai/core/ui";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";

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
import {
  draftsToRegions,
  planRegionsToDrafts,
} from "../workflows/FileUploadConnector/utils/layout-plan-mapping.util";

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

  /**
   * Connector instance id (for the breadcrumb back-link) and the
   * resolved instance name (or `null` while the sibling query is in
   * flight — in which case the breadcrumb falls back to a generic
   * "Connector" label).
   */
  connectorInstanceId: string;
  connectorInstanceName: string | null;

  /** Save Draft state (slice 3b). */
  isSavingDraft: boolean;
  saveDraftToast: { severity: "success" | "error"; message: string } | null;
  onDismissSaveDraftToast: () => void;

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
  onSaveDraft: () => void;
  onBack: () => void;
  onNavigate: (href: string) => void;
}

export const EditLayoutPlanViewUI: React.FC<EditLayoutPlanViewUIProps> = ({
  editContext,
  loading,
  loadError,
  commitError,
  isCommitting,
  connectorInstanceId,
  connectorInstanceName,
  isSavingDraft,
  saveDraftToast,
  onDismissSaveDraftToast,
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
  onSaveDraft,
  onBack,
  onNavigate,
}) => {
  // Breadcrumb shared by every branch (loading, error, not-editable, editor)
  // so the user always has a one-click path back to the detail view. The
  // third crumb falls back to a generic label while the connector-name
  // query is still in flight.
  const canSaveDraft = !!editContext?.editable;
  const saveDraftButton = canSaveDraft ? (
    <Button
      variant="contained"
      onClick={onSaveDraft}
      disabled={isSavingDraft}
    >
      {isSavingDraft ? "Saving…" : "Save draft"}
    </Button>
  ) : undefined;
  const header = (
    <PageHeader
      breadcrumbs={[
        { label: "Dashboard", href: "/" },
        { label: "Connectors", href: "/connectors" },
        {
          label: connectorInstanceName ?? "Connector",
          href: `/connectors/${connectorInstanceId}`,
        },
        { label: "Modify Layout Plan" },
      ]}
      onNavigate={onNavigate}
      title="Modify Layout Plan"
      icon={<Icon name={IconName.MemoryChip} />}
      primaryAction={saveDraftButton}
    />
  );

  // Toast renders identically across every branch — `loadError` and
  // `editable: false` branches surface their own messages, but a
  // successful Save Draft on a previously-edited plan can still race
  // a subsequent navigation and we want the user to see the
  // confirmation either way.
  const toast = (
    <Snackbar
      open={saveDraftToast !== null}
      autoHideDuration={saveDraftToast?.severity === "success" ? 4000 : null}
      onClose={(_evt, reason) => {
        if (reason === "clickaway" && saveDraftToast?.severity === "error") {
          return;
        }
        onDismissSaveDraftToast();
      }}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
    >
      {saveDraftToast ? (
        <Alert
          severity={saveDraftToast.severity}
          variant="filled"
          onClose={onDismissSaveDraftToast}
          sx={{ minWidth: 320 }}
          data-testid={`save-draft-toast-${saveDraftToast.severity}`}
        >
          {saveDraftToast.message}
        </Alert>
      ) : undefined}
    </Snackbar>
  );

  if (loading) {
    return (
      <Box>
        <Stack spacing={4}>
          {header}
          <Typography>Loading layout plan…</Typography>
        </Stack>
        {toast}
      </Box>
    );
  }
  if (loadError) {
    return (
      <Box>
        <Stack spacing={4}>
          {header}
          <FormAlert serverError={loadError} />
          <Box>
            <Button onClick={onBack} variant="outlined">
              Back
            </Button>
          </Box>
        </Stack>
        {toast}
      </Box>
    );
  }
  if (!editContext) return null;

  if (!editContext.editable) {
    return (
      <Box>
        <Stack spacing={4}>
          {header}
          <Box sx={{ maxWidth: 720 }}>
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
        </Stack>
        {toast}
      </Box>
    );
  }

  const workbook = previewToEditorWorkbook(editContext.workbookPreview!);
  // Entity-catalog wiring stays out of slice 3b; the editor's
  // entity-picker just doesn't show staged options here. Adding it
  // belongs in a follow-up that surfaces the org's full entity
  // catalog as picker options.
  const entityOptions: EntityOption[] = [];

  return (
    <Box>
      <Stack spacing={4}>
        {header}
        {commitError ? <FormAlert serverError={commitError} /> : null}
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
          // Edit mode doesn't re-run interpret — the editor's
          // "Interpret" button is a no-op here. Save Draft is the
          // intended way to persist edits without re-running
          // classification.
          onInterpret={() => undefined}
          onJumpToRegion={onJumpToRegion}
          onEditBinding={onEditBinding}
          onCommit={onCommit}
          onBack={onBack}
          isCommitting={isCommitting}
        />
      </Stack>
      {toast}
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

  // Lookup the connector instance's display name for the breadcrumb.
  // React Query dedups with the detail view's cache hit, so this is
  // typically a no-op extra round-trip in practice.
  const instanceQuery = sdk.connectorInstances.get(connectorInstanceId);
  const connectorInstanceName =
    instanceQuery.data?.connectorInstance.name ?? null;

  const { mutateAsync: recommitMutate, isPending: isCommitting, error: commitMutationError } =
    sdk.connectorInstanceLayoutPlans.commit(
      connectorInstanceId,
      editContext?.planId ?? ""
    );

  const { mutateAsync: patchPlanMutate, isPending: isSavingDraft } =
    sdk.connectorInstanceLayoutPlans.patch(
      connectorInstanceId,
      editContext?.planId ?? ""
    );

  const [saveDraftToast, setSaveDraftToast] = useState<
    { severity: "success" | "error"; message: string } | null
  >(null);

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

  const handleSaveDraft = useCallback(async () => {
    if (!editContext?.editable || !editContext.workbookPreview) return;
    const workbook = previewToEditorWorkbook(editContext.workbookPreview);
    let nextRegions;
    try {
      nextRegions = draftsToRegions(regions, workbook, editContext.plan);
    } catch (err) {
      setSaveDraftToast({
        severity: "error",
        message: err instanceof Error ? err.message : "Failed to save plan",
      });
      return;
    }
    try {
      await patchPlanMutate({
        regions: nextRegions,
      });
      // The cache hit on `queryKeys.connectorInstanceLayoutPlans.root`
      // re-fetches the edit context so the next mount sees the saved
      // version. The current view's local draft state is the source
      // of truth until the user leaves and re-enters.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.connectorInstanceLayoutPlans.root,
      });
      setSaveDraftToast({ severity: "success", message: "Plan saved." });
    } catch (err) {
      const apiErr = err as { message?: string } | null;
      setSaveDraftToast({
        severity: "error",
        message: apiErr?.message ?? "Failed to save plan.",
      });
    }
  }, [editContext, regions, patchPlanMutate, queryClient]);

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
      connectorInstanceId={connectorInstanceId}
      connectorInstanceName={connectorInstanceName}
      isSavingDraft={isSavingDraft}
      saveDraftToast={saveDraftToast}
      onDismissSaveDraftToast={() => setSaveDraftToast(null)}
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
      onSaveDraft={handleSaveDraft}
      onBack={handleBack}
      onNavigate={(href) => navigate({ to: href })}
    />
  );
};
