import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";

import type {
  ConnectorEntityCreateRequestBody,
  ConnectorEntityListRequestQuery,
  ConnectorEntityListWithMappingsResponsePayload,
  ConnectorInstanceGetResponsePayload,
  ConnectorInstancePatchRequestBody,
} from "@portalai/core/contracts";
import {
  Box,
  Button,
  Icon,
  IconName,
  MetadataList,
  PageEmptyState,
  PageHeader,
  PageSection,
  Stack,
} from "@portalai/core/ui";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Tooltip from "@mui/material/Tooltip";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ViewQuiltIcon from "@mui/icons-material/ViewQuilt";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { upperFirst } from "lodash-es";

import { sdk, queryKeys } from "../api/sdk";
import { sse } from "../api/sse.api";
import { awaitJobCompletion } from "../utils/job-stream.util";
import { toServerError } from "../utils/api.util";
import { ConnectorInstanceDataItem } from "../components/ConnectorInstance.component";
import { ConnectorInstanceLockAlertUI } from "../components/ConnectorInstanceLockAlert.component";
import { ConnectorInstanceReconnectButtonUI } from "../components/ConnectorInstanceReconnectButton.component";
import { ConnectorInstanceSyncButtonUI } from "../components/ConnectorInstanceSyncButton.component";
import { ConnectorInstanceSyncFeedbackUI } from "../components/ConnectorInstanceSyncFeedback.component";
import { joinRunningJobLabels } from "../utils/running-job-label.util";
import { HighlightedCode } from "../components/HighlightedCode.component";
import { useConnectorInstanceSync } from "../utils/use-connector-instance-sync.util";
import { useReconnectConnectorInstance } from "../utils/use-reconnect-connector-instance.util";
import {
  ConnectorEntityDataList,
  ConnectorEntityCardUI,
} from "../components/ConnectorEntity.component";
import { CreateConnectorEntityDialog } from "../components/CreateConnectorEntityDialog.component";
import DataResult from "../components/DataResult.component";
import { DeleteConnectorInstanceDialog } from "../components/DeleteConnectorInstanceDialog.component";
import { EditConnectorInstanceDialog } from "../components/EditConnectorInstanceDialog.component";
import { SyncTotal } from "../components/SyncTotal.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";

const STATUS_COLOR: Record<
  string,
  "success" | "error" | "warning" | "default"
> = {
  active: "success",
  error: "error",
  pending: "warning",
  inactive: "default",
};

/**
 * Connector slugs whose layout plans can be opened in the edit-plan
 * view. Mirrors the backend's `EDITABLE_SLUGS` in
 * `connector-instance-layout-plans.service.ts` — cloud-only.
 * File-upload connectors don't appear here: the original CSV / XLSX
 * was a one-shot artifact and there's no "live" upstream to reshape
 * the plan against. Recovery for a file-upload's stale layout is to
 * delete and re-upload.
 */
const EDIT_PLAN_SLUGS = new Set(["google-sheets", "microsoft-excel"]);

/**
 * Heuristic: does the sync failure message indicate Google rejected
 * our refresh token? If so, the inline Reconnect CTA appears in the
 * sync-failure alert. We pattern-match the upstream `GoogleAuthError`
 * kinds (`refresh_failed`, `invalid_grant`) which the access-token
 * cache surfaces verbatim. A future plan note (Phase E §Slice 4
 * refactor) is to upgrade the SSE event to carry a structured `code`
 * field so this branch doesn't depend on string matching.
 */
function isAuthFailureMessage(message: string | null): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("invalid_grant") ||
    lower.includes("refresh_failed") ||
    lower.includes("refresh_token")
  );
}

interface ConnectorInstanceViewProps {
  connectorInstanceId: string;
}

export const ConnectorInstanceView = ({
  connectorInstanceId,
}: ConnectorInstanceViewProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [createEntityOpen, setCreateEntityOpen] = useState(false);

  const createEntityMutation = sdk.connectorEntities.create();
  const deleteMutation = sdk.connectorInstances.delete(connectorInstanceId);
  const renameMutation = sdk.connectorInstances.rename(connectorInstanceId);
  const updateMutation = sdk.connectorInstances.update(connectorInstanceId);
  const impactQuery = sdk.connectorInstances.impact(connectorInstanceId, {
    enabled: deleteDialogOpen,
  });
  // SSE-driven invalidation: the query fetches once on mount; an
  // effect below subscribes to `/api/sse/jobs/:id/events` for each
  // running job and invalidates this query when the terminal event
  // lands. No polling needed — the alert clears the moment the
  // worker finishes.
  const runningJobsQuery = sdk.connectorInstances.runningJobs(
    connectorInstanceId
  );
  // Memoize so the array identity is stable across renders — the
  // lock-SSE effect below lists `runningJobs` in its deps and would
  // otherwise re-subscribe on every render (the `?? []` makes a fresh
  // array each time).
  const runningJobs = useMemo(
    () => runningJobsQuery.data?.runningJobs ?? [],
    [runningJobsQuery.data?.runningJobs]
  );
  const connectSseForLock = sse.create();
  /**
   * Tracks which running-job SSE streams we already have open, so
   * re-renders don't double-subscribe. Cleared per-job on terminal
   * event + on connector-instance change + on unmount. Holding
   * AbortControllers lets us cancel a subscription if the job
   * disappears from the running-jobs list without our terminal
   * handler having fired (defensive — e.g., if the backend ever
   * adds a "lock revoked" path that doesn't go through the SSE
   * channel).
   */
  const lockSubscriptionsRef = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const subs = lockSubscriptionsRef.current;
    const runningIds = new Set(runningJobs.map((j) => j.id));
    // Cancel subscriptions whose jobs have left the running list
    // (terminal events normally remove them via the finally hook
    // below, but defend against the backend pruning them another way).
    for (const [jobId, ac] of subs.entries()) {
      if (!runningIds.has(jobId)) {
        ac.abort();
        subs.delete(jobId);
      }
    }
    // Subscribe to any newly-seen running jobs.
    for (const job of runningJobs) {
      if (subs.has(job.id)) continue;
      const ac = new AbortController();
      subs.set(job.id, ac);
      // catch+finally handles both `completed` and `failed`/`cancelled`
      // identically — in every case the lock is released and we need
      // to refetch so the alert + button state reflect reality.
      awaitJobCompletion(connectSseForLock, job.id, { signal: ac.signal })
        .catch(() => undefined)
        .finally(() => {
          if (subs.get(job.id) === ac) subs.delete(job.id);
          queryClient.invalidateQueries({
            queryKey:
              queryKeys.connectorInstances.runningJobs(connectorInstanceId),
          });
          // A terminal job almost always means the connector instance
          // row itself changed: layout_plan_commit flips `status`
          // (pending → ready on success, pending → error on failure),
          // connector_sync bumps `lastSyncAt` / `lastErrorMessage`,
          // etc. Without this invalidation the status chip on the
          // detail view sticks to whatever it was when the page first
          // loaded.
          queryClient.invalidateQueries({
            queryKey:
              queryKeys.connectorInstances.get(connectorInstanceId),
          });
          queryClient.invalidateQueries({
            queryKey: queryKeys.connectorInstances.root,
          });
          // The same terminal events also reshape downstream data:
          // - `layout_plan_commit` creates / replaces `connector_entities`
          //   rows and writes / clears `entity_records`.
          // - `connector_sync` upserts records into the existing
          //   entities and may soft-delete rows past the watermark.
          // Without these invalidations the entities table on the detail
          // view stays stuck at whatever was cached when the page first
          // loaded — typically empty for a fresh commit — and the
          // records pages a level deeper show stale rows.
          queryClient.invalidateQueries({
            queryKey: queryKeys.connectorEntities.root,
          });
          queryClient.invalidateQueries({
            queryKey: queryKeys.entityRecords.root,
          });
        });
    }
    return () => {
      // On unmount, abort everything. Re-renders only trigger this
      // when `connectorInstanceId` changes — same-id re-renders
      // pass through because the ref persists across them.
    };
  }, [runningJobs, connectorInstanceId, connectSseForLock, queryClient]);
  // Final cleanup: abort every open SSE on view unmount or
  // connector-instance switch.
  useEffect(() => {
    const subs = lockSubscriptionsRef.current;
    return () => {
      for (const ac of subs.values()) ac.abort();
      subs.clear();
    };
  }, [connectorInstanceId]);
  const isLocked = runningJobs.length > 0;
  const lockedReason = isLocked
    ? `${joinRunningJobLabels(runningJobs)} is running on this connector — try again when it finishes.`
    : null;
  const syncState = useConnectorInstanceSync(connectorInstanceId);
  // When the user kicks off a sync from inside this view, refetch
  // the runningJobs list so the lock alert appears immediately
  // instead of waiting for the next mount or for the worker's
  // first SSE event to propagate. The backend lock check is the
  // actual safety — this is purely a UX hint.
  useEffect(() => {
    if (syncState.jobStatus !== null) {
      queryClient.invalidateQueries({
        queryKey:
          queryKeys.connectorInstances.runningJobs(connectorInstanceId),
      });
    }
  }, [syncState.jobStatus, connectorInstanceId, queryClient]);
  // Read slug off the cached connector-instance query so the reconnect
  // hook can dispatch to the right SDK group + popup hook. Same query
  // key as `ConnectorInstanceDataItem` below — React Query dedups, so
  // this isn't a second network round-trip.
  const instanceQueryForSlug = sdk.connectorInstances.get(connectorInstanceId);
  const definitionSlug =
    instanceQueryForSlug.data?.connectorInstance.connectorDefinition?.slug ??
    "";
  const reconnectState = useReconnectConnectorInstance(
    connectorInstanceId,
    definitionSlug
  );

  const handleDelete = useCallback(() => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        setDeleteDialogOpen(false);
        queryClient.invalidateQueries({
          queryKey: queryKeys.connectorInstances.root,
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.connectorEntities.root,
        });
        queryClient.invalidateQueries({ queryKey: queryKeys.stations.root });
        queryClient.invalidateQueries({
          queryKey: queryKeys.fieldMappings.root,
        });
        navigate({ to: "/connectors" });
      },
    });
  }, [deleteMutation, queryClient, navigate]);

  const handleRename = useCallback(
    (newName: string) => {
      renameMutation.mutate(
        { name: newName },
        {
          onSuccess: () => {
            setEditDialogOpen(false);
            queryClient.invalidateQueries({
              queryKey: queryKeys.connectorInstances.root,
            });
            queryClient.invalidateQueries({
              queryKey: queryKeys.connectorInstances.get(connectorInstanceId),
            });
          },
        }
      );
    },
    [renameMutation, queryClient, connectorInstanceId]
  );

  const handleCapabilityChange = useCallback(
    (body: ConnectorInstancePatchRequestBody) => {
      updateMutation.mutate(body, {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: queryKeys.connectorInstances.root,
          });
          queryClient.invalidateQueries({
            queryKey: queryKeys.connectorInstances.get(connectorInstanceId),
          });
        },
      });
    },
    [updateMutation, queryClient, connectorInstanceId]
  );

  const handleCreateEntityClose = useCallback(() => {
    setCreateEntityOpen(false);
    createEntityMutation.reset();
  }, [createEntityMutation]);

  const handleCreateEntitySubmit = useCallback(
    (body: ConnectorEntityCreateRequestBody) => {
      createEntityMutation.mutate(body, {
        onSuccess: () => {
          handleCreateEntityClose();
          queryClient.invalidateQueries({
            queryKey: queryKeys.connectorEntities.root,
          });
        },
      });
    },
    [createEntityMutation, handleCreateEntityClose, queryClient]
  );

  const pagination = usePagination({
    sortFields: [
      { field: "key", label: "Key" },
      { field: "label", label: "Label" },
      { field: "created", label: "Created" },
    ],
    defaultSortBy: "created",
    defaultSortOrder: "asc",
  });

  return (
    <Box>
      <ConnectorInstanceDataItem id={connectorInstanceId}>
        {(instanceResult) => (
          <DataResult results={{ instance: instanceResult }}>
            {({
              instance,
            }: {
              instance: ConnectorInstanceGetResponsePayload;
            }) => {
              const ci = instance.connectorInstance;
              const isWriteEnabled = ci.enabledCapabilityFlags?.write === true;
              // Primary action decision tree (ordered from most-urgent
              // to least): error → reconnect; sync configured → sync;
              // else → edit. The reconnect path supersedes sync because
              // sync can't succeed against revoked credentials anyway,
              // and we don't want the user clicking Sync first only to
              // see another auth error.
              const isInError = ci.status === "error";
              const isSyncConfigured =
                ci.enabledCapabilityFlags?.sync === true;
              const editAction = (
                <Tooltip title={lockedReason ?? ""} disableHoverListener={!isLocked}>
                  <span>
                    <Button
                      variant="contained"
                      startIcon={<EditIcon />}
                      onClick={() => setEditDialogOpen(true)}
                      disabled={isLocked}
                    >
                      Edit
                    </Button>
                  </span>
                </Tooltip>
              );
              const syncAction = (
                <ConnectorInstanceSyncButtonUI
                  syncEligible={ci.syncEligible ?? false}
                  identityWarnings={ci.identityWarnings}
                  isStarting={syncState.isStarting}
                  jobStatus={syncState.jobStatus}
                  onSync={syncState.onSync}
                  variant="contained"
                  lockedReason={lockedReason}
                />
              );
              const reconnectAction = (
                <ConnectorInstanceReconnectButtonUI
                  status={ci.status}
                  isReconnecting={reconnectState.isReconnecting}
                  errorMessage={reconnectState.errorMessage}
                  onReconnect={reconnectState.onReconnect}
                  onDismissError={reconnectState.onDismissError}
                  variant="contained"
                />
              );
              const primaryAction = isInError
                ? reconnectAction
                : isSyncConfigured
                  ? syncAction
                  : editAction;
              const slug = ci.connectorDefinition?.slug ?? "";
              const canEditLayoutPlan = EDIT_PLAN_SLUGS.has(slug);
              // Modify Layout Plan is only meaningful for connectors
              // with a live upstream the user can reshape against
              // (`EDIT_PLAN_SLUGS`). For everything else we don't
              // render the entry at all — a disabled item just
              // clutters the menu with an unactionable affordance.
              const secondaryActions = [
                ...(isInError || isSyncConfigured
                  ? [
                    {
                      label: "Edit",
                      icon: <EditIcon />,
                      onClick: () => setEditDialogOpen(true),
                      disabled: isLocked,
                    },
                  ]
                  : []),
                ...(canEditLayoutPlan
                  ? [
                      {
                        label: "Modify Layout Plan",
                        icon: <ViewQuiltIcon />,
                        onClick: () =>
                          navigate({
                            to: "/connectors/$connectorInstanceId/layout-plan/edit",
                            params: { connectorInstanceId },
                          }),
                        disabled: isLocked,
                      },
                    ]
                  : []),
                {
                  label: "Delete",
                  icon: <DeleteIcon />,
                  onClick: () => setDeleteDialogOpen(true),
                  color: "error" as const,
                  disabled: isLocked,
                },
              ];
              return (
                <Stack spacing={4}>
                  <ConnectorInstanceLockAlertUI runningJobs={runningJobs} />
                  <PageHeader
                    breadcrumbs={[
                      { label: "Dashboard", href: "/" },
                      { label: "Connectors", href: "/connectors" },
                      { label: ci.name },
                    ]}
                    onNavigate={(href) => navigate({ to: href })}
                    title={ci.name}
                    icon={<Icon name={IconName.MemoryChip} />}
                    primaryAction={primaryAction}
                    secondaryActions={secondaryActions}
                  >
                    <MetadataList
                      direction="vertical"
                      layout="responsive"
                      items={[
                        {
                          label: "Status",
                          value: (
                            <Chip
                              label={upperFirst(ci.status)}
                              size="small"
                              color={STATUS_COLOR[ci.status] ?? "default"}
                              variant="outlined"
                            />
                          ),
                          variant: "chip",
                        },
                        {
                          label: "Connector",
                          value: ci.connectorDefinition?.display ?? "",
                          hidden: !ci.connectorDefinition,
                        },
                        {
                          label: "Config",
                          value: (
                            <HighlightedCode
                              code={JSON.stringify(ci.config, null, 2)}
                              language="json"
                              maxHeight={320}
                            />
                          ),
                          hidden:
                            !ci.config || Object.keys(ci.config).length === 0,
                        },
                        {
                          label: "Last sync",
                          value: ci.lastSyncAt
                            ? new Date(ci.lastSyncAt).toLocaleString()
                            : "",
                          hidden: !ci.lastSyncAt,
                        },
                        {
                          label: "Error",
                          value: ci.lastErrorMessage ?? "",
                          hidden: !(
                            ci.status === "error" && ci.lastErrorMessage
                          ),
                        },
                        {
                          label: "Created",
                          value: new Date(ci.created).toLocaleString(),
                        },
                        {
                          label: "Capabilities",
                          value: (() => {
                            const defFlags =
                              ci.connectorDefinition?.capabilityFlags;
                            const flags = ci.enabledCapabilityFlags;
                            const writeSupported = !!defFlags?.write;
                            const syncSupported = !!defFlags?.sync;
                            const pushSupported = !!defFlags?.push;

                            const makeHandler =
                              (flag: "write" | "sync" | "push") =>
                                (
                                  _e: React.ChangeEvent<HTMLInputElement>,
                                  checked: boolean
                                ) => {
                                  handleCapabilityChange({
                                    name: ci.name,
                                    enabledCapabilityFlags: {
                                      ...flags,
                                      read: true,
                                      [flag]: checked,
                                    },
                                  });
                                };

                            return (
                              <Stack
                                direction="row"
                                spacing={1}
                                alignItems="center"
                              >
                                <Tooltip title="Allow reading data from this connector">
                                  <FormControlLabel
                                    control={
                                      <Checkbox checked disabled size="small" />
                                    }
                                    label="Read"
                                  />
                                </Tooltip>
                                <Tooltip
                                  title={
                                    writeSupported
                                      ? "Allow creating, editing, and deleting entities, records, and field mappings"
                                      : "This connector type does not support writes"
                                  }
                                >
                                  <FormControlLabel
                                    control={
                                      <Checkbox
                                        checked={!!flags?.write}
                                        onChange={makeHandler("write")}
                                        disabled={
                                          !writeSupported ||
                                          updateMutation.isPending
                                        }
                                        size="small"
                                      />
                                    }
                                    label="Write"
                                  />
                                </Tooltip>
                                <Tooltip
                                  title={
                                    syncSupported
                                      ? "Allow data synchronization with the source"
                                      : "This connector type does not support sync"
                                  }
                                >
                                  <FormControlLabel
                                    control={
                                      <Checkbox
                                        checked={!!flags?.sync}
                                        onChange={makeHandler("sync")}
                                        disabled={
                                          !syncSupported ||
                                          updateMutation.isPending
                                        }
                                        size="small"
                                      />
                                    }
                                    label="Sync"
                                  />
                                </Tooltip>
                                <Tooltip
                                  title={
                                    pushSupported
                                      ? "Allow pushing normalized data to external destinations"
                                      : "This connector type does not support push"
                                  }
                                >
                                  <FormControlLabel
                                    control={
                                      <Checkbox
                                        checked={!!flags?.push}
                                        onChange={makeHandler("push")}
                                        disabled={
                                          !pushSupported ||
                                          updateMutation.isPending
                                        }
                                        size="small"
                                      />
                                    }
                                    label="Push"
                                  />
                                </Tooltip>
                              </Stack>
                            );
                          })(),
                          variant: "chip",
                        },
                      ]}
                    />
                  </PageHeader>

                  {/* Section 2: Entities List */}
                  <PageSection
                    title="Entities"
                    icon={<Icon name={IconName.DataObject} />}
                    primaryAction={
                      isWriteEnabled ? (
                        <Tooltip
                          title={lockedReason ?? ""}
                          disableHoverListener={!isLocked}
                        >
                          <span>
                            <Button
                              variant="contained"
                              size="small"
                              onClick={() => setCreateEntityOpen(true)}
                              disabled={isLocked}
                            >
                              Create Entity
                            </Button>
                          </span>
                        </Tooltip>
                      ) : null
                    }
                  >
                    <PaginationToolbar {...pagination.toolbarProps} />

                    <Box sx={{ mt: 2 }}>
                      <ConnectorEntityDataList
                        query={
                          {
                            connectorInstanceIds: connectorInstanceId,
                            include: "fieldMappings",
                            ...pagination.queryParams,
                          } as ConnectorEntityListRequestQuery
                        }
                      >
                        {(entitiesResult) => (
                          <SyncTotal
                            total={entitiesResult.data?.total}
                            setTotal={pagination.setTotal}
                          >
                            <DataResult results={{ entities: entitiesResult }}>
                              {({
                                entities,
                              }: {
                                entities: ConnectorEntityListWithMappingsResponsePayload;
                              }) => {
                                if (entities.connectorEntities.length === 0) {
                                  return (
                                    <PageEmptyState
                                      icon={<Icon name={IconName.DataObject} />}
                                      title="No entities found"
                                    />
                                  );
                                }

                                return (
                                  <Stack spacing={1}>
                                    {entities.connectorEntities.map(
                                      (entity) => (
                                        <ConnectorEntityCardUI
                                          key={entity.id}
                                          connectorEntity={entity}
                                        />
                                      )
                                    )}
                                  </Stack>
                                );
                              }}
                            </DataResult>
                          </SyncTotal>
                        )}
                      </ConnectorEntityDataList>
                    </Box>
                  </PageSection>
                  <DeleteConnectorInstanceDialog
                    open={deleteDialogOpen}
                    onClose={() => setDeleteDialogOpen(false)}
                    connectorInstanceName={ci.name}
                    onConfirm={handleDelete}
                    isPending={deleteMutation.isPending}
                    impact={impactQuery.data ?? null}
                    isLoadingImpact={impactQuery.isLoading && deleteDialogOpen}
                    serverError={toServerError(deleteMutation.error)}
                  />

                  <EditConnectorInstanceDialog
                    open={editDialogOpen}
                    onClose={() => setEditDialogOpen(false)}
                    currentName={ci.name}
                    onConfirm={handleRename}
                    isPending={renameMutation.isPending}
                  />

                  <CreateConnectorEntityDialog
                    open={createEntityOpen}
                    onClose={handleCreateEntityClose}
                    onSubmit={handleCreateEntitySubmit}
                    isPending={createEntityMutation.isPending}
                    serverError={toServerError(createEntityMutation.error)}
                    lockedConnectorInstance={{
                      id: connectorInstanceId,
                      name: ci.name,
                    }}
                  />
                  {/*
                      Sync feedback floats in a closeable toast (Snackbar)
                      anchored bottom-right — keeps the view surface
                      uncluttered while the job runs. The component renders
                      nothing when there's no in-flight job and no
                      finished result/error to show.
                    */}
                  {isSyncConfigured ? (
                    <ConnectorInstanceSyncFeedbackUI
                      jobStatus={syncState.jobStatus}
                      progress={syncState.progress}
                      recordCounts={syncState.recordCounts}
                      errorMessage={syncState.errorMessage}
                      onDismissResult={syncState.onDismissResult}
                      showReconnect={isAuthFailureMessage(
                        syncState.errorMessage
                      )}
                      onReconnect={reconnectState.onReconnect}
                      isReconnecting={reconnectState.isReconnecting}
                    />
                  ) : null}
                </Stack>
              );
            }}
          </DataResult>
        )}
      </ConnectorInstanceDataItem>
    </Box>
  );
};
