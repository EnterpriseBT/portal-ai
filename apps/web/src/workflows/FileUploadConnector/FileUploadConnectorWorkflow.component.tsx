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
import type { FileUploadParseSheet } from "@portalai/core/contracts";

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
  preserveUserRegionConfig,
  regionDraftsToHints,
} from "./utils/layout-plan-mapping.util";
import { lockPlanIdentityToRowPosition } from "./utils/lock-identity.util";

import { sdk, queryKeys } from "../../api/sdk";
import { putToS3 } from "../../api/file-uploads.api";
import type {
  CellBounds,
  CellValue,
  ColumnBindingDraft,
  EntityOption,
  LoadSliceFn,
  RegionDraft,
  RegionEditorErrors,
  SheetPreview,
  Workbook,
} from "../../modules/RegionEditor";
import type { SelectOption } from "@portalai/core/ui";
import type { ColumnDataType } from "@portalai/core/models";
import type { SearchResult } from "../../api/types";
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
 * Convert the backend's parse-session response into the `Workbook` the
 * RegionEditor renders. Inlined sheets are flattened into a dense 2D array;
 * sheets served via the sliced path come back with `cells: []` and stay
 * empty, so the canvas treats every row as unloaded and fetches via
 * `loadSlice` as it scrolls.
 */
function backendParseSheetsToPreview(
  sheets: FileUploadParseSheet[],
  sourceLabel: string
): Workbook {
  const out: SheetPreview[] = sheets.map((sheet) => {
    const rows = sheet.dimensions.rows;
    const cols = sheet.dimensions.cols;
    const cells: CellValue[][] =
      sheet.cells.length === 0
        ? []
        : Array.from({ length: rows }, (_, r) =>
            Array.from({ length: cols }, (_, c) => {
              const raw = sheet.cells[r]?.[c];
              if (raw === undefined || raw === null) return "";
              return raw as CellValue;
            })
          );
    return {
      id: sheet.id,
      name: sheet.name,
      rowCount: rows,
      colCount: cols,
      cells,
    };
  });
  return { sheets: out, sourceLabel };
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
  validateEntityKey?: (
    key: string
  ) => Promise<{ ok: true } | { ok: false; ownedBy?: string }>;
  onInterpret: () => void;
  /**
   * Shortcut back to the review step when a plan already exists. Unset when
   * no interpretation has run yet, which hides the button.
   */
  onSkipToReview?: () => void;

  // Review step
  overallConfidence?: number;
  onJumpToRegion: (regionId: string) => void;
  onEditBinding: (regionId: string, sourceLocator: string) => void;
  onUpdateBinding?: (
    regionId: string,
    sourceLocator: string,
    patch: Partial<ColumnBindingDraft>
  ) => void;
  onToggleBindingExcluded?: (
    regionId: string,
    sourceLocator: string,
    excluded: boolean
  ) => void;
  columnDefinitionSearch?: SearchResult<SelectOption>;
  resolveReferenceOptions?: (region: RegionDraft) => SelectOption[];
  resolveReferenceFieldOptions?: (
    region: RegionDraft,
    refEntityKey: string | null | undefined
  ) => SelectOption[];
  resolveColumnDefinitionType?: (
    binding: ColumnBindingDraft
  ) => ColumnDataType | undefined;
  resolveColumnDefinitionDescription?: (
    binding: ColumnBindingDraft
  ) => string | null | undefined;
  resolveColumnLabel?: (columnDefinitionId: string) => string | undefined;
  onCommit: () => void;

  // Navigation
  onBack: () => void;

  // Status
  errors?: RegionEditorErrors;
  /**
   * Field-level errors from the upload step (e.g. oversize files rejected
   * pre-flight before any S3 upload). Surfaced via UploadStep's `errors.files`.
   */
  uploadErrors?: { files?: string };
  serverError: ServerError | null;
  isInterpreting: boolean;
  isCommitting: boolean;

  // Lazy-loaded cells for sliced sheets. Undefined for workbooks whose cells
  // were inlined in the parse response.
  loadSlice?: LoadSliceFn;
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
  validateEntityKey,
  onInterpret,
  onSkipToReview,
  overallConfidence,
  onJumpToRegion,
  onEditBinding,
  onUpdateBinding,
  onToggleBindingExcluded,
  columnDefinitionSearch,
  resolveReferenceOptions,
  resolveReferenceFieldOptions,
  resolveColumnDefinitionType,
  resolveColumnDefinitionDescription,
  resolveColumnLabel,
  onCommit,
  onBack,
  errors,
  uploadErrors,
  serverError,
  isInterpreting,
  isCommitting,
  loadSlice,
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
                errors={uploadErrors}
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
                  validateEntityKey={validateEntityKey}
                  onInterpret={onInterpret}
                  onSkipToReview={onSkipToReview}
                  isInterpreting={isInterpreting}
                  errors={errors}
                  serverError={serverError}
                  loadSlice={loadSlice}
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
                onUpdateBinding={onUpdateBinding}
                onToggleBindingExcluded={onToggleBindingExcluded}
                columnDefinitionSearch={columnDefinitionSearch}
                resolveReferenceOptions={resolveReferenceOptions}
                resolveReferenceFieldOptions={resolveReferenceFieldOptions}
                resolveColumnDefinitionType={resolveColumnDefinitionType}
                resolveColumnDefinitionDescription={
                  resolveColumnDefinitionDescription
                }
                resolveColumnLabel={resolveColumnLabel}
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

  const { mutateAsync: presignMutate } = sdk.fileUploads.presign();
  const { mutateAsync: confirmMutate } = sdk.fileUploads.confirm();
  const { mutateAsync: parseMutate } = sdk.fileUploads.parse();
  const { mutateAsync: sheetSliceMutate } = sdk.fileUploads.sheetSlice();
  const { mutateAsync: interpretMutate } = sdk.layoutPlans.interpret();
  const { mutateAsync: commitMutate } = sdk.layoutPlans.commit();
  const workbookRef = useRef<Workbook | null>(null);
  const uploadSessionIdRef = useRef<string | null>(null);
  const filesRef = useRef<File[]>([]);

  // Handed to the canvas so sliced sheets can fetch cells on scroll. The
  // reference closure reads `uploadSessionIdRef.current` per call, so a
  // single stable callback works across parse → review without needing to
  // be rebuilt when the session id changes.
  const loadSlice: LoadSliceFn = useCallback(
    async ({ sheetId, rowStart, rowEnd, colStart, colEnd }) => {
      const uploadSessionId = uploadSessionIdRef.current;
      if (!uploadSessionId) throw new Error("Upload session missing");
      const res = await sheetSliceMutate({
        uploadSessionId,
        sheetId,
        rowStart,
        rowEnd,
        colStart,
        colEnd,
      });
      return res.cells;
    },
    [sheetSliceMutate]
  );

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

  const parseFile: FileUploadWorkflowCallbacks["parseFile"] = useCallback(
    async (files, options) => {
      if (files.length === 0) throw new Error("No file selected");
      filesRef.current = files;

      // 1) Mint presigned PUT URLs — one row per file in status "pending".
      const presignPayload = await presignMutate({
        files: files.map((f) => ({
          fileName: f.name,
          contentType: f.type || "application/octet-stream",
          sizeBytes: f.size,
        })),
      });

      // 2) PUT each file directly to S3. XHR progress events feed the hook.
      await Promise.all(
        files.map((file, i) =>
          putToS3(file, presignPayload.uploads[i].putUrl, {
            onProgress: (loaded, total) =>
              options?.onProgress?.({ fileName: file.name, loaded, total }),
            signal: options?.signal,
          })
        )
      );

      // 3) Confirm each upload — backend HEADs S3 + flips row to "uploaded".
      await Promise.all(
        presignPayload.uploads.map((u) =>
          confirmMutate({ uploadId: u.uploadId })
        )
      );

      // 4) Stream parse — returns the preview workbook + uploadSessionId.
      const parsePayload = await parseMutate({
        uploadIds: presignPayload.uploads.map((u) => u.uploadId),
      });

      const sourceLabel =
        files.length === 1 ? files[0].name : `${files.length} files`;
      const converted = backendParseSheetsToPreview(
        parsePayload.sheets,
        sourceLabel
      );
      workbookRef.current = converted;
      uploadSessionIdRef.current = parsePayload.uploadSessionId;
      return {
        workbook: converted,
        uploadSessionId: parsePayload.uploadSessionId,
      };
    },
    [presignMutate, confirmMutate, parseMutate]
  );

  const runInterpret: FileUploadWorkflowCallbacks["runInterpret"] = useCallback(
    async (regions) => {
      const workbook = workbookRef.current;
      const uploadSessionId = uploadSessionIdRef.current;
      if (!workbook) throw new Error("Workbook not parsed");
      if (!uploadSessionId) throw new Error("Upload session missing");
      const res = await interpretMutate({
        uploadSessionId,
        regionHints: regionDraftsToHints(workbook, regions),
      });
      const plan = lockPlanIdentityToRowPosition(
        preserveUserRegionConfig(res.plan, regions)
      );
      return {
        regions: planRegionsToDrafts(plan, workbook),
        plan,
        overallConfidence: overallConfidenceFromPlan(plan),
      };
    },
    [interpretMutate]
  );

  const runCommit: FileUploadWorkflowCallbacks["runCommit"] = useCallback(
    async (plan) => {
      const uploadSessionId = uploadSessionIdRef.current;
      if (!uploadSessionId) throw new Error("Upload session missing");
      const res = await commitMutate({
        connectorDefinitionId,
        name: deriveConnectorInstanceName(filesRef.current),
        plan,
        uploadSessionId,
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
    uploadSessionIdRef.current = null;
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

  // The interpret endpoint returns column bindings keyed by columnDefinitionId
  // — opaque UUIDs. Fetch the org's ColumnDefinition catalog so the review and
  // region-editor panels can show the human label on each binding chip.
  const columnDefinitionsQuery = sdk.columnDefinitions.list({
    limit: 1000,
    offset: 0,
    sortBy: "label",
    sortOrder: "asc",
  });
  const columnDefinitionsById = useMemo(() => {
    const map = new Map<
      string,
      { label: string; type: ColumnDataType; description: string | null }
    >();
    const rows = columnDefinitionsQuery.data?.columnDefinitions ?? [];
    for (const cd of rows) {
      map.set(cd.id, {
        label: cd.label,
        type: cd.type as ColumnDataType,
        description: cd.description,
      });
    }
    return map;
  }, [columnDefinitionsQuery.data]);

  const regionsWithResolvedLabels = useMemo(() => {
    if (columnDefinitionsById.size === 0) {
      return workflow.regions;
    }
    return workflow.regions.map((region) => {
      if (!region.columnBindings || region.columnBindings.length === 0) {
        return region;
      }
      return {
        ...region,
        columnBindings: region.columnBindings.map((binding) => {
          if (!binding.columnDefinitionId) return binding;
          const meta = columnDefinitionsById.get(binding.columnDefinitionId);
          if (!meta) return binding;
          return {
            ...binding,
            columnDefinitionLabel: binding.columnDefinitionLabel ?? meta.label,
            columnDefinitionType: binding.columnDefinitionType ?? meta.type,
          };
        }),
      };
    });
  }, [workflow.regions, columnDefinitionsById]);

  // Search hooks for the binding editor popover. `columnDefinitions.search`
  // populates the rebind picker; `connectorEntities.search` populates the
  // reference editor's DB-target half (staged entities come from `regions`).
  const columnDefinitionSearch = sdk.columnDefinitions.search();
  const connectorEntitySearch = sdk.connectorEntities.search();

  const resolveColumnDefinitionType = useCallback(
    (binding: ColumnBindingDraft): ColumnDataType | undefined => {
      // Prefer a fresh catalog lookup keyed by the currently-selected id so
      // the returned type always matches the current binding. The cached
      // `binding.columnDefinitionType` can drift from `columnDefinitionId`
      // when the user swaps definitions in the popover — treating it as
      // authoritative surfaced as the binding editor failing to show
      // reference/enum sub-fields after a rebind.
      if (binding.columnDefinitionId) {
        const fromCatalog = columnDefinitionsById.get(
          binding.columnDefinitionId
        )?.type;
        if (fromCatalog) return fromCatalog;
      }
      return binding.columnDefinitionType;
    },
    [columnDefinitionsById]
  );

  const resolveColumnDefinitionDescription = useCallback(
    (binding: ColumnBindingDraft): string | null | undefined => {
      if (!binding.columnDefinitionId) return undefined;
      return columnDefinitionsById.get(binding.columnDefinitionId)?.description;
    },
    [columnDefinitionsById]
  );

  const resolveColumnLabel = useCallback(
    (columnDefinitionId: string): string | undefined =>
      columnDefinitionsById.get(columnDefinitionId)?.label,
    [columnDefinitionsById]
  );

  // C2 pre-check: before staging a newly-created entity, make sure no
  // other connector in this org already owns the chosen key. Reuses the
  // connectorEntity search SDK (org-scoped by auth) so callers don't
  // need to re-fetch at commit time.
  const validateEntityKey = useCallback(
    async (
      key: string
    ): Promise<{ ok: true } | { ok: false; ownedBy?: string }> => {
      const results = await connectorEntitySearch.onSearch(key);
      // Search is key|label ilike; filter to exact key match.
      const exact = results.find((r) => String(r.value) === key);
      if (!exact) return { ok: true };
      const metaMap = connectorEntitySearch.metaMap ?? {};
      const ownedBy = metaMap[String(exact.value)]?.connectorInstanceName;
      return { ok: false, ownedBy };
    },
    [connectorEntitySearch]
  );

  // Reference-target options — staged sibling entities first (prefixed "this
  // import"), then DB-backed options resolved by the connectorEntity search.
  const resolveReferenceOptions = useCallback(
    (currentRegion: RegionDraft): SelectOption[] => {
      const staged = new Map<string, SelectOption>();
      for (const r of workflow.regions) {
        if (!r.targetEntityDefinitionId) continue;
        if (r.id === currentRegion.id) continue; // self-references disallowed
        if (staged.has(r.targetEntityDefinitionId)) continue;
        const label = r.targetEntityLabel ?? r.targetEntityDefinitionId;
        staged.set(r.targetEntityDefinitionId, {
          value: r.targetEntityDefinitionId,
          label: `${label} (this import)`,
        });
      }
      // DB-backed options: C2 surfaces the owning connector's name via
      // `metaMap.connectorInstanceName` so the picker can disambiguate
      // across connectors within the same org.
      const metaMap = connectorEntitySearch.metaMap ?? {};
      const dbOptions = Object.entries(connectorEntitySearch.labelMap).map(
        ([value, label]) => {
          const connectorName = metaMap[value]?.connectorInstanceName;
          const suffix = connectorName
            ? ` (existing · ${connectorName})`
            : " (existing)";
          return { value, label: `${label}${suffix}` };
        }
      );
      const all = [...staged.values(), ...dbOptions];
      const seen = new Set<string>();
      return all.filter((opt) => {
        if (seen.has(String(opt.value))) return false;
        seen.add(String(opt.value));
        return true;
      });
    },
    [
      workflow.regions,
      connectorEntitySearch.labelMap,
      connectorEntitySearch.metaMap,
    ]
  );

  const resolveReferenceFieldOptions = useCallback(
    (
      _region: RegionDraft,
      refEntityKey: string | null | undefined
    ): SelectOption[] => {
      if (!refEntityKey) return [];
      // Staged target — derive from sibling region's bindings' normalizedKey
      // overrides + catalog keys. Commit reconciles with the same logic.
      const stagedRegion = workflow.regions.find(
        (r) => r.targetEntityDefinitionId === refEntityKey
      );
      if (stagedRegion) {
        const seen = new Set<string>();
        const out: SelectOption[] = [];
        for (const b of stagedRegion.columnBindings ?? []) {
          if (b.excluded) continue;
          const key =
            b.normalizedKey ??
            (b.columnDefinitionId
              ? columnDefinitionsById.get(b.columnDefinitionId)?.label ??
                b.columnDefinitionId
              : null);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push({ value: key, label: key });
        }
        return out;
      }
      // DB target — field list isn't loaded synchronously here; fall back to
      // an empty list so the select is disabled until the server validates.
      // Commit's reference validation (`LAYOUT_PLAN_INVALID_REFERENCE`) is
      // the safety net.
      return [];
    },
    [workflow.regions, columnDefinitionsById]
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
      fileProgress={workflow.fileProgressMap}
      overallUploadPercent={workflow.overallUploadPercent}
      onStartParse={() => {
        void workflow.startParse();
      }}
      workbook={workflow.workbook}
      regions={regionsWithResolvedLabels}
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
      validateEntityKey={validateEntityKey}
      onInterpret={() => {
        void workflow.onInterpret();
      }}
      onSkipToReview={workflow.plan ? workflow.onSkipToReview : undefined}
      overallConfidence={workflow.overallConfidence}
      onJumpToRegion={workflow.onJumpToRegion}
      onEditBinding={(regionId, _sourceLocator) => {
        // Fallback path — only fires when the popover isn't wired (any of
        // onUpdateBinding / onToggleBindingExcluded / columnDefinitionSearch
        // missing). The popover-enabled path below owns the affordance now.
        workflow.onJumpToRegion(regionId);
      }}
      onUpdateBinding={workflow.onUpdateBinding}
      onToggleBindingExcluded={workflow.onToggleBindingExcluded}
      columnDefinitionSearch={columnDefinitionSearch}
      resolveReferenceOptions={resolveReferenceOptions}
      resolveReferenceFieldOptions={resolveReferenceFieldOptions}
      resolveColumnDefinitionType={resolveColumnDefinitionType}
      resolveColumnDefinitionDescription={resolveColumnDefinitionDescription}
      resolveColumnLabel={resolveColumnLabel}
      onCommit={() => {
        void workflow.onCommit();
      }}
      onBack={workflow.goBack}
      uploadErrors={workflow.uploadErrors}
      serverError={workflow.serverError}
      isInterpreting={workflow.isInterpreting}
      isCommitting={workflow.isCommitting}
      loadSlice={loadSlice}
    />
  );
};
