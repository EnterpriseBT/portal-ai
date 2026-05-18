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
  LoadSliceFn,
  RegionDraft,
  Workbook,
} from "../modules/RegionEditor";
import {
  buildIdentityUpdater,
  resolveLocatorOptionsFor,
} from "../modules/RegionEditor/utils/identity-panel-wiring.util";
import { mergeRegionUpdate } from "../modules/RegionEditor/utils/adjust-segments-for-bounds.util";
import {
  draftsToRegions,
  entityOptionsFromWorkbook,
  mergeStagedEntityOptions,
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

  /**
   * Snackbar feedback for the auto-PATCH that fires inside the Commit
   * flow (originally a standalone Save Draft button; the user-visible
   * button was removed because the auto-save covers every case where
   * a user actually cared about persistence — clicking Commit). The
   * toast still exists because PATCH failures need to surface
   * somewhere before the commit-job error path can take over.
   */
  saveDraftToast: { severity: "success" | "error"; message: string } | null;
  onDismissSaveDraftToast: () => void;

  /**
   * Slice 3c — entity-picker catalog. Sheet-derived options merged
   * with user-staged extras (whatever the editor's "Create new entity"
   * affordance has produced this session). The picker is keyed on
   * `EntityOption.value`, which is the same id we ship as
   * `targetEntityDefinitionId` on save.
   */
  entityOptions: EntityOption[];
  onCreateEntity: (key: string, label: string) => string;

  /**
   * Slice 3c — per-rectangle slice loader for sheets too large to ship
   * inline in the edit-context preview. Routed by connector slug
   * inside the container; `undefined` for unsupported slugs.
   */
  loadSlice?: LoadSliceFn;

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
  /**
   * Wired to the ReviewStep's "Back to regions" button — steps from
   * review (step 1) back to draw-regions (step 0). Does NOT navigate
   * out of the view; that's `onLeaveView`'s job.
   */
  onBack: () => void;
  /**
   * Wired to the "Back" button on the placeholder branches
   * (load-error, SOURCE_REMOVED). The editor isn't mounted on those
   * branches so a step-back would be a no-op — leave the view
   * entirely and return to the connector detail page instead.
   */
  onLeaveView: () => void;
  onNavigate: (href: string) => void;
  /**
   * Advances the editor from "Draw regions" to "Review". The
   * RegionEditor module's primary CTA on step 0 is labeled
   * "Interpret" — in workflow mode it triggers the AI classifier
   * and then advances; in edit mode there's nothing to re-classify
   * (the plan is already committed), so the button simply advances
   * to review where the user can recommit. Without this wiring the
   * button is a no-op and looks broken.
   */
  onAdvanceToReview: () => void;

  /**
   * Per-region IdentityPanel dropdown options + change handler. The
   * panel's "Identity field" Select reads the picked column's display
   * label from these options — without them the label silently falls
   * back to empty and the panel looks like the region "never had" an
   * identity.
   */
  resolveIdentityLocatorOptions?: React.ComponentProps<
    typeof RegionEditorUI
  >["resolveIdentityLocatorOptions"];
  onIdentityUpdate?: React.ComponentProps<
    typeof RegionEditorUI
  >["onIdentityUpdate"];
}

export const EditLayoutPlanViewUI: React.FC<EditLayoutPlanViewUIProps> = ({
  editContext,
  loading,
  loadError,
  commitError,
  isCommitting,
  connectorInstanceId,
  connectorInstanceName,
  saveDraftToast,
  onDismissSaveDraftToast,
  entityOptions,
  onCreateEntity,
  loadSlice,
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
  onLeaveView,
  onNavigate,
  onAdvanceToReview,
  resolveIdentityLocatorOptions,
  onIdentityUpdate,
}) => {
  // Breadcrumb shared by every branch (loading, error, not-editable, editor)
  // so the user always has a one-click path back to the detail view. The
  // third crumb falls back to a generic label while the connector-name
  // query is still in flight. The header used to host a standalone
  // "Save draft" button — removed in favor of auto-saving inside the
  // Commit flow (see `handleCommit`'s leading PATCH).
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
            <Button onClick={onLeaveView} variant="outlined">
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
              <Button onClick={onLeaveView} variant="outlined">
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
          onCreateEntity={onCreateEntity}
          // Edit-mode locks: post-commit edits can change shape +
          // extent rules but not which entity a region populates,
          // and they can't delete a region either — rebinding or
          // removing would require record migration / cascade
          // soft-delete that the wide-table pipeline doesn't support
          // today.
          entityAssociationLocked={true}
          regionDeletionLocked={true}
          loadSlice={loadSlice}
          // Edit mode doesn't re-run the AI classifier — the regions
          // are already classified. The module's primary CTA on step
          // 0 is labeled "Interpret" though, so a no-op handler looks
          // broken to the user. Repurpose it as the step-advancer so
          // clicking "Interpret" jumps to the Review step where the
          // user can recommit.
          onInterpret={onAdvanceToReview}
          onJumpToRegion={onJumpToRegion}
          onEditBinding={onEditBinding}
          onCommit={onCommit}
          onBack={onBack}
          isCommitting={isCommitting}
          resolveIdentityLocatorOptions={resolveIdentityLocatorOptions}
          onIdentityUpdate={onIdentityUpdate}
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

  const {
    mutateAsync: recommitMutate,
    isPending: isRecommitting,
    error: commitMutationError,
  } = sdk.connectorInstanceLayoutPlans.commit(
    connectorInstanceId,
    editContext?.planId ?? ""
  );

  const { mutateAsync: patchPlanMutate, isPending: isAutoSaving } =
    sdk.connectorInstanceLayoutPlans.patch(
      connectorInstanceId,
      editContext?.planId ?? ""
    );

  // The Commit button stays disabled across both phases of the
  // commit flow — the leading auto-PATCH AND the recommit POST —
  // so users can't double-click between phases.
  const isCommitting = isRecommitting || isAutoSaving;

  // Slice 3c — sheet-slice loaders for big workbooks. All three SDK
  // hooks are invoked unconditionally so React Query's rules-of-hooks
  // contract holds across re-renders; the dispatcher below picks the
  // right one when `loadSlice` actually fires.
  const { mutateAsync: gsSheetSliceMutate } = sdk.googleSheets.sheetSlice();
  const { mutateAsync: msExcelSheetSliceMutate } =
    sdk.microsoftExcel.sheetSlice();
  const { mutateAsync: fileUploadSheetSliceMutate } =
    sdk.fileUploads.sheetSlice();

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

  // Slice 3c — entity-picker catalog. Sheet-derived options come from
  // the preview workbook; user-staged entries persist for the lifetime
  // of the mount (sheet options drop them on every re-derive otherwise).
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

  // Hydrate local state once the editable payload arrives. Also seed
  // `stagedEntities` from the existing plan's region targets so the
  // editor's entity-picker has a matching option for every region the
  // user is editing — otherwise `regionDraftsToHints` reads the
  // `targetEntityDefinitionId` from the draft and the picker can't
  // find it in `entityOptionsFromWorkbook(workbook)` (sheet-derived
  // ids), so the field renders empty and the region looks "new".
  React.useEffect(() => {
    if (!editContext?.editable || !editContext.workbookPreview) return;
    if (hydratedFromContextId === editContext.planId) return;
    const workbook = previewToEditorWorkbook(editContext.workbookPreview);
    // Build the catalog map first — used both to seed the picker's
    // option list AND to populate each region draft's display labels.
    const catalogById = new Map<string, string>(
      editContext.entityCatalog.map((e) => [e.id, e.label] as const)
    );
    // Hydrate region drafts. `planRegionsToDrafts` recovers everything
    // the backend persists — bounds, bindings, identity, terminators —
    // but the persisted Region schema does NOT carry `proposedLabel`
    // (the AI-proposed display name from interpret) or
    // `targetEntityLabel` (a denormalized convenience the editor uses
    // to render the picker chip without a second lookup). Both are
    // session-scoped fields on the draft. Without backfilling them
    // here, every region renders as "New region" with an empty Label
    // field, which makes the edit view look like it forgot the user's
    // prior work.
    //
    // Two-tier fallback:
    //   1. Catalog hit — the entity was persisted (commit succeeded),
    //      so we have the user's chosen label. Use it directly.
    //   2. Catalog miss — the commit failed before
    //      `connector_entities` rows were created (e.g. the drift
    //      gate halted it), so the only thing we have is the
    //      region's `targetEntityDefinitionId`, which is the key the
    //      user typed in the workflow. Use it verbatim so the chip
    //      and heading say "testtt" instead of "New region" — the
    //      user picked that key and will recognize it.
    const hydratedDrafts = planRegionsToDrafts(editContext.plan, workbook).map(
      (draft) => {
        const entityId = draft.targetEntityDefinitionId;
        if (!entityId) return draft;
        const entityLabel = catalogById.get(entityId) ?? entityId;
        return {
          ...draft,
          targetEntityLabel: entityLabel,
          proposedLabel: draft.proposedLabel ?? entityLabel,
        };
      }
    );
    setRegions(hydratedDrafts);
    // Auto-select the first region on the first sheet so the
    // configuration panel opens with real content instead of the
    // "no region selected" empty state. Without this, every edit-plan
    // mount looks blank until the user clicks a region in the canvas.
    const firstSheetId = workbook.sheets[0]?.id;
    const firstRegion = firstSheetId
      ? hydratedDrafts.find((r) => r.sheetId === firstSheetId)
      : hydratedDrafts[0];
    if (firstRegion) setSelectedRegionId(firstRegion.id);
    // Seed `stagedEntities` from the real `connector_entities`
    // catalog the backend returned. Falls back to the region's
    // targetEntityDefinitionId-as-label only if some region
    // references an id that's not in the catalog (defensive — the
    // catalog should be a superset of every region's target).
    const seeded: EntityOption[] = [];
    const seen = new Set<string>();
    for (const entry of editContext.entityCatalog) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      seeded.push({
        value: entry.id,
        label: entry.label,
        source: "staged" as const,
      });
    }
    for (const region of editContext.plan.regions) {
      const id = region.targetEntityDefinitionId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      seeded.push({
        value: id,
        label: catalogById.get(id) ?? id,
        source: "staged" as const,
      });
    }
    if (seeded.length > 0) setStagedEntities(seeded);
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
        prev.map((r) => (r.id === regionId ? mergeRegionUpdate(r, updates) : r))
      );
    },
    []
  );

  const handleRegionDelete = useCallback((regionId: string) => {
    setRegions((prev) => prev.filter((r) => r.id !== regionId));
    setSelectedRegionId((sel) => (sel === regionId ? null : sel));
  }, []);

  // Delegate to `handleRegionUpdate` so canvas drag-resize and
  // manual bounds inputs share one segment-adjustment path. The
  // util in `mergeRegionUpdate` auto-shrinks/expands the trailing
  // segment on each axis to match the new span and drops segments
  // the new bounds can't fit.
  const handleRegionResize = useCallback(
    (regionId: string, nextBounds: CellBounds) => {
      handleRegionUpdate(regionId, { bounds: nextBounds });
    },
    [handleRegionUpdate]
  );

  const handleCommit = useCallback(async () => {
    if (!editContext?.editable || !editContext.workbookPreview) return;
    // The commit endpoint's body schema requires exactly one of
    // `uploadSessionId` (file-upload) or `connectorInstanceId` (cloud
    // connectors: google-sheets, microsoft-excel) so the server knows
    // which chunked-cache prefix to read the workbook from. Without
    // this the 400 LAYOUT_PLAN_INVALID_PAYLOAD fires before the job
    // is even enqueued.
    const body =
      editContext.connectorDefinitionSlug === "file-upload"
        ? editContext.uploadSessionId
          ? { uploadSessionId: editContext.uploadSessionId }
          : null
        : { connectorInstanceId };
    if (!body) {
      // file-upload connector with no recoverable upload session —
      // the edit-context branch should have rendered the
      // SOURCE_REMOVED notice and not even mounted the editor, but
      // defend against the user reaching Commit anyway.
      return;
    }
    // The recommit endpoint reads the plan from the DB by planId; it
    // does NOT accept regions in the request body. Local edits in the
    // editor (identity changes, bounds tweaks, binding overrides) are
    // session-scoped until a PATCH lands. Without auto-saving here,
    // clicking Commit re-runs the unchanged stored plan — so e.g. an
    // identity change made specifically to clear `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED`
    // is silently dropped and the same drift error fires again. Auto-PATCH
    // first, then enqueue the commit job against the freshly-persisted plan.
    const workbook = previewToEditorWorkbook(editContext.workbookPreview);
    let nextRegions;
    try {
      nextRegions = draftsToRegions(regions, workbook, editContext.plan);
    } catch (err) {
      setSaveDraftToast({
        severity: "error",
        message:
          err instanceof Error
            ? `Couldn't save plan before commit: ${err.message}`
            : "Couldn't save plan before commit.",
      });
      return;
    }
    try {
      await patchPlanMutate({ regions: nextRegions });
    } catch (err) {
      const apiErr = err as { message?: string } | null;
      setSaveDraftToast({
        severity: "error",
        message: apiErr?.message ?? "Couldn't save plan before commit.",
      });
      return;
    }
    try {
      await recommitMutate(body);
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
    editContext,
    regions,
    patchPlanMutate,
    recommitMutate,
    queryClient,
    navigate,
    connectorInstanceId,
  ]);

  // The ReviewStep's "Back to regions" button is the only consumer
  // of `onBack`. It's a STEP-back (review → draw), not a route-back —
  // leaving the view entirely is the breadcrumb's (or the placeholder
  // branches') job.
  const handleBack = useCallback(() => {
    setStep(0);
  }, []);
  // The placeholder branches (load-error, SOURCE_REMOVED) render a
  // "Back" button when no editor is mounted. `handleBack`'s
  // step-back is a no-op there, so we need a real route-back.
  const handleLeaveView = useCallback(() => {
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

  // Slice 3c — merge sheet-derived options with the user's staged
  // extras. `entityOptionsFromWorkbook(null)` returns `[]`, so the
  // memo is stable while the edit-context is still loading.
  const entityOptions = useMemo(() => {
    if (!editContext?.editable || !editContext.workbookPreview) {
      return stagedEntities;
    }
    const workbook = previewToEditorWorkbook(editContext.workbookPreview);
    return mergeStagedEntityOptions(
      entityOptionsFromWorkbook(workbook),
      stagedEntities
    );
  }, [editContext, stagedEntities]);

  // Slice 3c — per-rectangle slice loader. Dispatches by the connector
  // definition slug; file-upload also needs the `uploadSessionId` the
  // backend echoes in the edit-context response. `undefined` for
  // slugs the edit flow doesn't support (the editor falls back to
  // the inline cells if any, then renders empty rectangles).
  const loadSlice = useMemo<LoadSliceFn | undefined>(() => {
    if (!editContext?.editable) return undefined;
    const slug = editContext.connectorDefinitionSlug;
    if (slug === "google-sheets") {
      return async ({ sheetId, rowStart, rowEnd, colStart, colEnd }) => {
        const res = await gsSheetSliceMutate({
          connectorInstanceId,
          sheetId,
          rowStart,
          rowEnd,
          colStart,
          colEnd,
        });
        return res.cells;
      };
    }
    if (slug === "microsoft-excel") {
      return async ({ sheetId, rowStart, rowEnd, colStart, colEnd }) => {
        const res = await msExcelSheetSliceMutate({
          connectorInstanceId,
          sheetId,
          rowStart,
          rowEnd,
          colStart,
          colEnd,
        });
        return res.cells;
      };
    }
    if (slug === "file-upload" && editContext.uploadSessionId) {
      const uploadSessionId = editContext.uploadSessionId;
      return async ({ sheetId, rowStart, rowEnd, colStart, colEnd }) => {
        const res = await fileUploadSheetSliceMutate({
          uploadSessionId,
          sheetId,
          rowStart,
          rowEnd,
          colStart,
          colEnd,
        });
        return res.cells;
      };
    }
    return undefined;
  }, [
    editContext,
    connectorInstanceId,
    gsSheetSliceMutate,
    msExcelSheetSliceMutate,
    fileUploadSheetSliceMutate,
  ]);

  return (
    <EditLayoutPlanViewUI
      editContext={editContext}
      loading={editContextQuery.isLoading}
      loadError={loadError}
      commitError={commitError}
      isCommitting={isCommitting}
      connectorInstanceId={connectorInstanceId}
      connectorInstanceName={connectorInstanceName}
      saveDraftToast={saveDraftToast}
      onDismissSaveDraftToast={() => setSaveDraftToast(null)}
      entityOptions={entityOptions}
      onCreateEntity={handleCreateEntity}
      loadSlice={loadSlice}
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
      onLeaveView={handleLeaveView}
      onNavigate={(href) => navigate({ to: href })}
      onAdvanceToReview={() => setStep(1)}
      resolveIdentityLocatorOptions={
        editContext?.editable && editContext.workbookPreview
          ? (region: RegionDraft) =>
              resolveLocatorOptionsFor(
                previewToEditorWorkbook(editContext.workbookPreview!),
                region
              )
          : undefined
      }
      onIdentityUpdate={
        editContext?.editable && editContext.workbookPreview
          ? buildIdentityUpdater({
              workbook: previewToEditorWorkbook(
                editContext.workbookPreview
              ),
              regions,
              onRegionUpdate: handleRegionUpdate,
            })
          : undefined
      }
    />
  );
};
