import { useState, useCallback } from "react";

import type {
  ConnectorEntityListRequestQuery,
  ConnectorEntityListWithMappingsResponsePayload,
  ConnectorInstanceGetResponsePayload,
} from "@portalai/core/contracts";
import { Box, Breadcrumbs, Button, Stack, Typography } from "@portalai/core/ui";
import { IconName } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { upperFirst } from "lodash-es";

import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";
import { ConnectorInstanceDataItem } from "../components/ConnectorInstance.component";
import {
  ConnectorEntityDataList,
  ConnectorEntityCardUI,
} from "../components/ConnectorEntity.component";
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

  const deleteMutation = sdk.connectorInstances.delete(connectorInstanceId);
  const renameMutation = sdk.connectorInstances.rename(connectorInstanceId);
  const impactQuery = sdk.connectorInstances.impact(connectorInstanceId, {
    enabled: deleteDialogOpen,
  });

  const handleDelete = useCallback(() => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        setDeleteDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.connectorInstances.root });
        navigate({ to: "/connectors" });
      },
    });
  }, [deleteMutation, queryClient, navigate]);

  const handleRename = useCallback(
    (newName: string) => {
      renameMutation.mutate({ name: newName }, {
        onSuccess: () => {
          setEditDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: queryKeys.connectorInstances.root });
          queryClient.invalidateQueries({ queryKey: queryKeys.connectorInstances.get(connectorInstanceId) });
        },
      });
    },
    [renameMutation, queryClient, connectorInstanceId]
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
              return (
                <Stack spacing={4}>
                  <Box>
                    <Breadcrumbs
                      items={[
                        { label: "Dashboard", href: "/", icon: IconName.Home },
                        { label: "Connectors", href: "/connectors" },
                        { label: ci.name },
                      ]}
                      onNavigate={(href) => navigate({ to: href })}
                    />

                    {/* Section 1: Instance Details */}
                    <Box>
                      <Stack
                        direction="row"
                        spacing={2}
                        alignItems="center"
                        sx={{ mb: 2 }}
                      >
                        <Typography variant="h1">{ci.name}</Typography>
                        <Chip
                          label={upperFirst(ci.status)}
                          size="small"
                          color={STATUS_COLOR[ci.status] ?? "default"}
                          variant="outlined"
                        />
                        <Box sx={{ flexGrow: 1 }} />
                        <Button
                          variant="outlined"
                          startIcon={<EditIcon />}
                          onClick={() => setEditDialogOpen(true)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="contained"
                          color="error"
                          startIcon={<DeleteOutlineIcon />}
                          onClick={() => setDeleteDialogOpen(true)}
                        >
                          Delete
                        </Button>
                      </Stack>

                      <Stack spacing={1}>
                        {ci.connectorDefinition && (
                          <Typography variant="body1" color="text.secondary">
                            Connector: {ci.connectorDefinition.display}
                          </Typography>
                        )}

                        {ci.config && Object.keys(ci.config).length > 0 && (
                          <Typography variant="body2" color="text.secondary">
                            Config: {JSON.stringify(ci.config)}
                          </Typography>
                        )}

                        {ci.lastSyncAt && (
                          <Typography variant="body2" color="text.secondary">
                            Last sync: {new Date(ci.lastSyncAt).toLocaleString()}
                          </Typography>
                        )}

                        {ci.status === "error" && ci.lastErrorMessage && (
                          <Typography variant="body2" color="error">
                            Error: {ci.lastErrorMessage}
                          </Typography>
                        )}

                        <Typography variant="body2" color="text.secondary">
                          Created: {new Date(ci.created).toLocaleString()}
                        </Typography>
                      </Stack>
                    </Box>
                  </Box>

                  {/* Section 2: Entities List */}
                  <Box>
                    <Typography variant="h2" sx={{ mb: 2 }}>
                      Entities
                    </Typography>

                    <PaginationToolbar {...pagination.toolbarProps} />

                    <Box sx={{ mt: 2 }}>
                      <ConnectorEntityDataList
                        query={{
                          connectorInstanceIds: connectorInstanceId,
                          include: "fieldMappings",
                          ...pagination.queryParams,
                        } as ConnectorEntityListRequestQuery}
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
                                    <Typography
                                      variant="body1"
                                      color="text.secondary"
                                      sx={{ py: 4, textAlign: "center" }}
                                    >
                                      No entities found
                                    </Typography>
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
                  </Box>
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
                </Stack>
              );
            }}
          </DataResult>
        )}
      </ConnectorInstanceDataItem>
    </Box>
  );
};
