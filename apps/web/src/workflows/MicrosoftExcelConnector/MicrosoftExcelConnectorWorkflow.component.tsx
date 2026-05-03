import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import type { SelectOption } from "@portalai/core/ui";
import type { ColumnDataType } from "@portalai/core/models";
import MicrosoftIcon from "@mui/icons-material/Microsoft";

import { OAuthAuthorizeStep } from "../../components/OAuthAuthorizeStep.component";
import type { OAuthAuthorizeStepState } from "../../components/OAuthAuthorizeStep.component";
import { SelectWorkbookStep } from "./SelectWorkbookStep.component";
import { MicrosoftExcelRegionDrawingStep } from "./MicrosoftExcelRegionDrawingStep.component";
import { MicrosoftExcelReviewStep } from "./MicrosoftExcelReviewStep.component";
import {
  MICROSOFT_EXCEL_WORKFLOW_STEPS,
  useMicrosoftExcelWorkflow,
} from "./utils/microsoft-excel-workflow.util";
import type { MicrosoftExcelWorkflowCallbacks } from "./utils/microsoft-excel-workflow.util";
import { useOAuthPopupAuthorize } from "../../utils/oauth-popup.util";
import { apiOrigin } from "../../utils/api-origin.util";
import {
  entityOptionsFromWorkbook,
  mergeStagedEntityOptions,
  overallConfidenceFromPlan,
  planRegionsToDrafts,
  preserveUserRegionConfig,
  regionDraftsToHints,
} from "../FileUploadConnector/utils/layout-plan-mapping.util";
import {
  buildIdentityUpdater,
  resolveLocatorOptionsFor,
} from "../../modules/RegionEditor/utils/identity-panel-wiring.util";

import { sdk, queryKeys } from "../../api/sdk";
import type {
  ColumnBindingDraft,
  EntityOption,
  LoadSliceFn,
  RegionDraft,
  Workbook,
} from "../../modules/RegionEditor";

const MICROSOFT_SCOPES_DESCRIPTION =
  "Authorize Portal.ai to read your Microsoft 365 Excel files in OneDrive. We only ever request read access — no writes, no deletions.";
const FALLBACK_TITLE = "Microsoft 365 Excel";

interface MicrosoftExcelConnectorWorkflowProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  connectorDefinitionId: string;
}

export const MicrosoftExcelConnectorWorkflow: React.FC<
  MicrosoftExcelConnectorWorkflowProps
> = ({ open, onClose, organizationId, connectorDefinitionId }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { mutateAsync: authorizeMutate } = sdk.microsoftExcel.authorize();
  const { mutateAsync: searchWorkbooksMutate } =
    sdk.microsoftExcel.searchWorkbooks();
  const { mutateAsync: selectWorkbookMutate } =
    sdk.microsoftExcel.selectWorkbook();
  const { mutateAsync: sheetSliceMutate } = sdk.microsoftExcel.sheetSlice();
  const { mutateAsync: interpretMutate } = sdk.layoutPlans.interpret();
  const { mutateAsync: commitMutate } = sdk.layoutPlans.commit();

  const popup = useOAuthPopupAuthorize({
    slug: "microsoft-excel",
    allowedOrigin: apiOrigin(),
  });

  const connectorInstanceIdRef = useRef<string | null>(null);
  const workbookRef = useRef<Workbook | null>(null);
  const workbookTitleRef = useRef<string>(FALLBACK_TITLE);

  const loadSlice: LoadSliceFn = useCallback(
    async ({ sheetId, rowStart, rowEnd, colStart, colEnd }) => {
      const ciId = connectorInstanceIdRef.current;
      if (!ciId) throw new Error("Connector instance missing");
      const res = await sheetSliceMutate({
        connectorInstanceId: ciId,
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

  // Staged entities created via "+ Create new entity" in the editor.
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

  // ── Workflow callbacks ─────────────────────────────────────────────

  const loadWorkbook: MicrosoftExcelWorkflowCallbacks["loadWorkbook"] =
    useCallback(
      async ({ connectorInstanceId, driveItemId }) => {
        const res = await selectWorkbookMutate({
          connectorInstanceId,
          driveItemId,
        });
        connectorInstanceIdRef.current = connectorInstanceId;
        // Capture the workbook title so the commit's `name` field shows
        // the user-recognizable workbook name on the connector card
        // (rather than the opaque driveItemId).
        workbookTitleRef.current = res.title || FALLBACK_TITLE;
        return res;
      },
      [selectWorkbookMutate]
    );

  const runInterpret: MicrosoftExcelWorkflowCallbacks["runInterpret"] =
    useCallback(
      async (regions) => {
        const workbook = workbookRef.current;
        const ciId = connectorInstanceIdRef.current;
        if (!workbook) throw new Error("Workbook not loaded");
        if (!ciId) throw new Error("Connector instance missing");
        const res = await interpretMutate({
          connectorInstanceId: ciId,
          regionHints: regionDraftsToHints(workbook, regions),
        });
        const plan = preserveUserRegionConfig(res.plan, regions);
        return {
          regions: planRegionsToDrafts(plan, workbook),
          plan,
          overallConfidence: overallConfidenceFromPlan(plan),
        };
      },
      [interpretMutate]
    );

  const runCommit: MicrosoftExcelWorkflowCallbacks["runCommit"] = useCallback(
    async (plan) => {
      const ciId = connectorInstanceIdRef.current;
      if (!ciId) throw new Error("Connector instance missing");
      const res = await commitMutate({
        connectorDefinitionId,
        name: workbookTitleRef.current,
        plan,
        connectorInstanceId: ciId,
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

  const workflow = useMicrosoftExcelWorkflow({
    loadWorkbook,
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

  // Mirror the workbook into a ref so loadSlice/interpret can read the
  // freshest value without dep-array gymnastics. Effect (post-render)
  // is the canonical place to mutate refs — doing it during render trips
  // react-hooks/refs and can race with concurrent rendering.
  useEffect(() => {
    if (workflow.workbook && workflow.workbook !== workbookRef.current) {
      workbookRef.current = workflow.workbook;
    }
  }, [workflow.workbook]);

  void organizationId;

  const handleClose = useCallback(() => {
    workbookRef.current = null;
    connectorInstanceIdRef.current = null;
    workbookTitleRef.current = FALLBACK_TITLE;
    setStagedEntities([]);
    workflow.reset();
    onClose();
  }, [workflow, onClose]);

  // ── Authorize step ─────────────────────────────────────────────────

  const [authorizeState, setAuthorizeState] =
    useState<OAuthAuthorizeStepState>("idle");
  const [authorizeError, setAuthorizeError] = useState<string | undefined>();

  const handleConnect = useCallback(async () => {
    setAuthorizeState("connecting");
    setAuthorizeError(undefined);
    try {
      const { url } = await authorizeMutate(undefined as never);
      const result = await popup.start(url);
      setAuthorizeState("authorized");
      workflow.setAuthorized({
        connectorInstanceId: result.connectorInstanceId,
        accountInfo: result.accountInfo,
      });
      connectorInstanceIdRef.current = result.connectorInstanceId;
    } catch (err) {
      setAuthorizeState("error");
      setAuthorizeError(
        err instanceof Error ? err.message : "Authorization failed"
      );
    }
  }, [authorizeMutate, popup, workflow]);

  // ── Select-workbook step search ────────────────────────────────────

  const handleSearchWorkbooks = useCallback(
    async (query: string): Promise<SelectOption[]> => {
      const ciId = workflow.connectorInstanceId;
      if (!ciId) return [];
      const res = await searchWorkbooksMutate({
        connectorInstanceId: ciId,
        search: query,
      });
      return res.items.map((item) => ({
        value: item.driveItemId,
        label: item.name,
      }));
    },
    [searchWorkbooksMutate, workflow.connectorInstanceId]
  );

  const handleSelectWorkbook = useCallback(
    (driveItemId: string) => {
      void workflow.selectWorkbook(driveItemId);
    },
    [workflow]
  );

  // ── Column definitions for binding labels (shared with file-upload) ─

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
    if (columnDefinitionsById.size === 0) return workflow.regions;
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

  const columnDefinitionSearch = sdk.columnDefinitions.search();
  const connectorEntitySearch = sdk.connectorEntities.search();

  const resolveColumnDefinitionType = useCallback(
    (binding: ColumnBindingDraft): ColumnDataType | undefined => {
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

  const validateEntityKey = useCallback(
    async (
      key: string
    ): Promise<{ ok: true } | { ok: false; ownedBy?: string }> => {
      const results = await connectorEntitySearch.onSearch(key);
      const exact = results.find((r) => String(r.value) === key);
      if (!exact) return { ok: true };
      const metaMap = connectorEntitySearch.metaMap ?? {};
      const ownedBy = metaMap[String(exact.value)]?.connectorInstanceName;
      return { ok: false, ownedBy };
    },
    [connectorEntitySearch]
  );

  const entityOptions = useMemo(
    () =>
      mergeStagedEntityOptions(
        entityOptionsFromWorkbook(workflow.workbook),
        stagedEntities
      ),
    [workflow.workbook, stagedEntities]
  );

  const resolveReferenceOptions = useCallback(
    (currentRegion: RegionDraft): SelectOption[] => {
      const staged = new Map<string, SelectOption>();
      for (const r of workflow.regions) {
        if (!r.targetEntityDefinitionId) continue;
        if (r.id === currentRegion.id) continue;
        if (staged.has(r.targetEntityDefinitionId)) continue;
        const label = r.targetEntityLabel ?? r.targetEntityDefinitionId;
        staged.set(r.targetEntityDefinitionId, {
          value: r.targetEntityDefinitionId,
          label: `${label} (this import)`,
        });
      }
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
      return [];
    },
    [workflow.regions, columnDefinitionsById]
  );

  // ── Render ─────────────────────────────────────────────────────────

  const resolvedActiveSheetId =
    workflow.activeSheetId ?? workflow.workbook?.sheets[0]?.id ?? "";

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Connect Microsoft 365 Excel"
      defaultMaximized
      maximizable
    >
      <Stack spacing={2} sx={{ minWidth: 0 }}>
        <Stepper
          steps={MICROSOFT_EXCEL_WORKFLOW_STEPS}
          activeStep={workflow.step}
        >
          <StepPanel index={0} activeStep={workflow.step}>
            <OAuthAuthorizeStep
              state={authorizeState}
              accountIdentity={workflow.accountInfo?.identity ?? null}
              error={authorizeError}
              onConnect={() => {
                void handleConnect();
              }}
              providerLabel="Microsoft 365"
              providerIcon={<MicrosoftIcon />}
              scopesDescription={MICROSOFT_SCOPES_DESCRIPTION}
            />
          </StepPanel>

          <StepPanel index={1} activeStep={workflow.step}>
            <SelectWorkbookStep
              value={workflow.driveItemId}
              onSelect={handleSelectWorkbook}
              searchFn={handleSearchWorkbooks}
              loading={workflow.isLoadingWorkbook}
              serverError={workflow.serverError}
            />
          </StepPanel>

          <StepPanel index={2} activeStep={workflow.step}>
            {workflow.workbook ? (
              <MicrosoftExcelRegionDrawingStep
                workbook={workflow.workbook}
                regions={regionsWithResolvedLabels}
                activeSheetId={resolvedActiveSheetId}
                onActiveSheetChange={workflow.onActiveSheetChange}
                selectedRegionId={workflow.selectedRegionId}
                onSelectRegion={workflow.onSelectRegion}
                onRegionDraft={workflow.onRegionDraft}
                onRegionUpdate={workflow.onRegionUpdate}
                onRegionResize={(regionId, nextBounds) =>
                  workflow.onRegionUpdate(regionId, { bounds: nextBounds })
                }
                onRegionDelete={workflow.onRegionDelete}
                entityOptions={entityOptions}
                onCreateEntity={handleCreateEntity}
                validateEntityKey={validateEntityKey}
                onInterpret={() => {
                  void workflow.onInterpret();
                }}
                onSkipToReview={
                  workflow.plan ? workflow.onSkipToReview : undefined
                }
                isInterpreting={workflow.isInterpreting}
                serverError={workflow.serverError}
                loadSlice={loadSlice}
              />
            ) : (
              <Box sx={{ p: 3 }}>
                <Typography color="text.secondary">
                  Loading your workbook…
                </Typography>
              </Box>
            )}
          </StepPanel>

          <StepPanel index={3} activeStep={workflow.step}>
            <MicrosoftExcelReviewStep
              regions={regionsWithResolvedLabels}
              overallConfidence={workflow.overallConfidence}
              onJumpToRegion={workflow.onJumpToRegion}
              onEditBinding={(regionId) => workflow.onJumpToRegion(regionId)}
              onUpdateBinding={workflow.onUpdateBinding}
              onToggleBindingExcluded={workflow.onToggleBindingExcluded}
              columnDefinitionSearch={columnDefinitionSearch}
              resolveReferenceOptions={resolveReferenceOptions}
              resolveReferenceFieldOptions={resolveReferenceFieldOptions}
              resolveColumnDefinitionType={resolveColumnDefinitionType}
              resolveColumnDefinitionDescription={
                resolveColumnDefinitionDescription
              }
              resolveColumnLabel={resolveColumnLabel}
              resolveIdentityLocatorOptions={(region) =>
                resolveLocatorOptionsFor(workflow.workbook, region)
              }
              onIdentityUpdate={buildIdentityUpdater({
                workbook: workflow.workbook,
                regions: workflow.regions,
                onRegionUpdate: workflow.onRegionUpdate,
              })}
              onCommit={() => {
                void workflow.onCommit();
              }}
              onBack={workflow.goBack}
              isCommitting={workflow.isCommitting}
              serverError={workflow.serverError}
            />
          </StepPanel>
        </Stepper>

        {workflow.step === 0 && (
          <Stack direction="row" justifyContent="flex-start" sx={{ pt: 1 }}>
            <Button variant="text" onClick={handleClose}>
              Cancel
            </Button>
          </Stack>
        )}
        {workflow.step === 1 && (
          <Stack direction="row" justifyContent="flex-start" sx={{ pt: 1 }}>
            <Button variant="text" onClick={handleClose}>
              Cancel
            </Button>
          </Stack>
        )}
        {workflow.step === 2 && (
          <Stack direction="row" justifyContent="flex-start" sx={{ pt: 1 }}>
            <Button variant="text" onClick={workflow.goBack}>
              Back
            </Button>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
};
