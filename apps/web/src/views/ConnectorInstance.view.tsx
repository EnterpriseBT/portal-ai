import React, { useState, useCallback } from "react";

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
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { upperFirst } from "lodash-es";

import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";
import { ConnectorInstanceDataItem } from "../components/ConnectorInstance.component";
import { ConnectorInstanceReconnectButtonUI } from "../components/ConnectorInstanceReconnectButton.component";
import { ConnectorInstanceSyncButtonUI } from "../components/ConnectorInstanceSyncButton.component";
import { ConnectorInstanceSyncFeedbackUI } from "../components/ConnectorInstanceSyncFeedback.component";
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
  const syncState = useConnectorInstanceSync(connectorInstanceId);
  const reconnectState = useReconnectConnectorInstance(connectorInstanceId);

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
                <Button
                  variant="contained"
                  startIcon={<EditIcon />}
                  onClick={() => setEditDialogOpen(true)}
                >
                  Edit
                </Button>
              );
              const syncAction = (
                <ConnectorInstanceSyncButtonUI
                  syncEligible={ci.syncEligible ?? false}
                  isStarting={syncState.isStarting}
                  jobStatus={syncState.jobStatus}
                  onSync={syncState.onSync}
                  variant="contained"
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
              const secondaryActions = [
                ...(isInError || isSyncConfigured
                  ? [
                      {
                        label: "Edit",
                        icon: <EditIcon />,
                        onClick: () => setEditDialogOpen(true),
                      },
                    ]
                  : []),
                {
                  label: "Delete",
                  icon: <DeleteIcon />,
                  onClick: () => setDeleteDialogOpen(true),
                  color: "error" as const,
                },
              ];
              return (
                <Stack spacing={4}>
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
                    {isSyncConfigured ? (
                      <Box sx={{ mt: 1, mb: 2 }}>
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
                      </Box>
                    ) : null}
                    <MetadataList
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
                            <Box
                              component="pre"
                              sx={{
                                fontFamily: "monospace",
                                fontSize: "0.8125rem",
                                backgroundColor: "action.hover",
                                borderRadius: 1,
                                px: 1.5,
                                py: 1,
                                m: 0,
                                overflow: "auto",
                                maxHeight: 320,
                                whiteSpace: "pre",
                              }}
                            >
                              {JSON.stringify(ci.config, null, 2)}
                            </Box>
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
                        <Button
                          variant="contained"
                          size="small"
                          onClick={() => setCreateEntityOpen(true)}
                        >
                          Create Entity
                        </Button>
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
                </Stack>
              );
            }}
          </DataResult>
        )}
      </ConnectorInstanceDataItem>
    </Box>
  );
};
