import { useState, useCallback } from "react";

import type {
  ConnectorEntityListRequestQuery,
  ConnectorEntityListWithMappingsResponsePayload,
  ConnectorInstanceGetResponsePayload,
} from "@portalai/core/contracts";
import { Box, Button, Icon, IconName, MetadataList, PageEmptyState, PageHeader, PageSection, Stack } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import DeleteIcon from "@mui/icons-material/Delete";
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
        queryClient.invalidateQueries({ queryKey: queryKeys.connectorEntities.root });
        queryClient.invalidateQueries({ queryKey: queryKeys.stations.root });
        queryClient.invalidateQueries({ queryKey: queryKeys.fieldMappings.root });
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
                  <PageHeader
                    breadcrumbs={[
                      { label: "Dashboard", href: "/" },
                      { label: "Connectors", href: "/connectors" },
                      { label: ci.name },
                    ]}
                    onNavigate={(href) => navigate({ to: href })}
                    title={ci.name}
                    icon={<Icon name={IconName.MemoryChip} />}
                    primaryAction={
                      <Button
                        variant="contained"
                        startIcon={<EditIcon />}
                        onClick={() => setEditDialogOpen(true)}
                      >
                        Edit
                      </Button>
                    }
                    secondaryActions={[
                      { label: "Delete", icon: <DeleteIcon />, onClick: () => setDeleteDialogOpen(true), color: "error" },
                    ]}
                  >
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
                        { label: "Connector", value: ci.connectorDefinition?.display ?? "", hidden: !ci.connectorDefinition },
                        { label: "Config", value: ci.config ? JSON.stringify(ci.config) : "", hidden: !ci.config || Object.keys(ci.config).length === 0, variant: "mono" },
                        { label: "Last sync", value: ci.lastSyncAt ? new Date(ci.lastSyncAt).toLocaleString() : "", hidden: !ci.lastSyncAt },
                        { label: "Error", value: ci.lastErrorMessage ?? "", hidden: !(ci.status === "error" && ci.lastErrorMessage) },
                        { label: "Created", value: new Date(ci.created).toLocaleString() },
                      ]}
                    />
                  </PageHeader>

                  {/* Section 2: Entities List */}
                  <PageSection title="Entities" icon={<Icon name={IconName.DataObject} />}>
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
                </Stack>
              );
            }}
          </DataResult>
        )}
      </ConnectorInstanceDataItem>
    </Box>
  );
};
