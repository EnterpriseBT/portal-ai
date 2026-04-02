import { useCallback, useState } from "react";
import type { ComponentType } from "react";

import {
  Box,
  Icon,
  IconName,
  PageEmptyState,
  PageHeader,
  Stack,
  Tab,
  TabPanel,
  Tabs,
  useTabs,
} from "@portalai/core/ui";
import type { ConnectorDefinition } from "@portalai/core/models";
import type {
  ConnectorDefinitionListRequestQuery,
  ConnectorInstanceApi,
  ConnectorInstanceListRequestQuery,
} from "@portalai/core/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { sdk, queryKeys } from "../api/sdk";
import {
  ConnectorDefinitionCardUI,
  ConnectorDefinitionDataList,
} from "../components/ConnectorDefinition.component";
import {
  ConnectorInstanceCardUI,
  ConnectorInstanceWithDefinitionDataList,
} from "../components/ConnectorInstance.component";
import DataResult from "../components/DataResult.component";
import { DeleteConnectorInstanceDialog } from "../components/DeleteConnectorInstanceDialog.component";
import { EmptyResults } from "../components/EmptyResults.component";
import {
  PaginationToolbar,
  usePagination,
} from "../components/PaginationToolbar.component";
import { SyncTotal } from "../components/SyncTotal.component";
import { CSVConnectorWorkflow } from "../workflows/CSVConnector";
import { SandboxConnectorWorkflow } from "../workflows/SandboxConnector";

export interface ConnectorWorkflowProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  connectorDefinitionId: string;
}

const WORKFLOW_REGISTRY: Record<
  string,
  ComponentType<ConnectorWorkflowProps>
> = {
  csv: CSVConnectorWorkflow,
  sandbox: SandboxConnectorWorkflow,
};

export const ConnectorView = () => {
  const { tabsProps, getTabProps, getTabPanelProps } = useTabs();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [selectedConnectorDefinitionId, setSelectedConnectorDefinitionId] =
    useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const deleteMutation = sdk.connectorInstances.delete(deleteTarget?.id ?? "");
  const impactQuery = sdk.connectorInstances.impact(deleteTarget?.id ?? "", {
    enabled: deleteDialogOpen && !!deleteTarget,
  });

  const handleDeleteClick = useCallback((ci: ConnectorInstanceApi) => {
    setDeleteTarget({ id: ci.id, name: ci.name });
    setDeleteDialogOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        setDeleteDialogOpen(false);
        setDeleteTarget(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.connectorInstances.root });
        queryClient.invalidateQueries({ queryKey: queryKeys.connectorEntities.root });
        queryClient.invalidateQueries({ queryKey: queryKeys.stations.root });
        queryClient.invalidateQueries({ queryKey: queryKeys.fieldMappings.root });
      },
    });
  }, [deleteMutation, queryClient]);

  const { data: orgData } = sdk.organizations.current();
  const organizationId = orgData?.organization.id ?? "";

  const handleConnect = useCallback((cd: ConnectorDefinition) => {
    setSelectedConnectorDefinitionId(cd.id);
    setSelectedSlug(cd.slug);
    setWorkflowOpen(true);
  }, []);

  const handleCloseWorkflow = useCallback(() => {
    setWorkflowOpen(false);
    setSelectedConnectorDefinitionId(null);
    setSelectedSlug(null);
  }, []);

  // --- Instance pagination (Tab 0) ---
  const instancePagination = usePagination({
    defaultSortBy: "created",
    defaultSortOrder: "desc",
    limit: 10,
    sortFields: [
      { field: "name", label: "Name" },
      { field: "status", label: "Status" },
      { field: "created", label: "Created" },
    ],
    filters: [
      {
        type: "multi-select",
        field: "status",
        label: "Status",
        options: [
          { label: "Active", value: "active" },
          { label: "Inactive", value: "inactive" },
          { label: "Error", value: "error" },
          { label: "Pending", value: "pending" },
        ],
      },
    ],
  });

  const handleInstanceClick = useCallback(
    (ci: ConnectorInstanceApi) => {
      navigate({ to: `/connectors/${ci.id}` });
    },
    [navigate]
  );

  // --- Definition pagination (Tab 1) ---
  const catalogPagination = usePagination({
    defaultSortBy: "display",
    defaultSortOrder: "asc",
    limit: 5,
    sortFields: [
      { field: "display", label: "Name" },
      { field: "category", label: "Category" },
      { field: "created", label: "Created" },
    ],
    filters: [
      {
        type: "boolean",
        field: "isActive",
        defaultValue: ["true"],
        label: "Active",
      },
    ],
  });

  return (
    <Box>
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Connectors" },
        ]}
        onNavigate={(href) => navigate({ to: href })}
        title="Connectors"
        icon={<Icon name={IconName.MemoryChip} />}
      />
      <Tabs {...tabsProps}>
        <Tab label="Connected" {...getTabProps(0)} />
        <Tab label="Catalog" {...getTabProps(1)} />
      </Tabs>

      <TabPanel {...getTabPanelProps(0)}>
        <Stack spacing={2}>
          <PaginationToolbar {...instancePagination.toolbarProps} />
          <ConnectorInstanceWithDefinitionDataList
            query={instancePagination.queryParams as ConnectorInstanceListRequestQuery}
          >
            {(response) => (
              <SyncTotal
                total={response.data?.total}
                setTotal={instancePagination.setTotal}
              >
                <DataResult results={{ connectorInstances: response }}>
                  {({ connectorInstances }) =>
                    connectorInstances.total === 0 ? (
                      (instancePagination.search || Object.values(instancePagination.filters).some(v => v.length > 0)) ? (
                        <EmptyResults />
                      ) : (
                        <PageEmptyState
                          icon={<Icon name={IconName.MemoryChip} />}
                          title="No connectors found"
                        />
                      )
                    ) : (
                      <Stack spacing={1}>
                        {connectorInstances.connectorInstances.map((ci) => (
                          <ConnectorInstanceCardUI
                            key={ci.id}
                            connectorInstance={ci}
                            connectorDefinition={
                              ci.connectorDefinition ?? undefined
                            }
                            onClick={handleInstanceClick}
                            onDelete={handleDeleteClick}
                          />
                        ))}
                      </Stack>
                    )
                  }
                </DataResult>
              </SyncTotal>
            )}
          </ConnectorInstanceWithDefinitionDataList>
        </Stack>
      </TabPanel>

      <TabPanel {...getTabPanelProps(1)}>
        <Stack spacing={2}>
          <PaginationToolbar {...catalogPagination.toolbarProps} />
          <ConnectorDefinitionDataList
            query={
              catalogPagination.queryParams as ConnectorDefinitionListRequestQuery
            }
          >
            {(response) => (
              <SyncTotal
                total={response.data?.total}
                setTotal={catalogPagination.setTotal}
              >
                <DataResult results={{ connectorDefinitions: response }}>
                  {({ connectorDefinitions }) =>
                    connectorDefinitions.total === 0 ? (
                      (catalogPagination.search || Object.values(catalogPagination.filters).some(v => v.length > 0)) ? (
                        <EmptyResults />
                      ) : (
                        <PageEmptyState
                          icon={<Icon name={IconName.MemoryChip} />}
                          title="No connector definitions found"
                        />
                      )
                    ) : (
                      <Stack spacing={1}>
                        {connectorDefinitions.connectorDefinitions.map((cd) => (
                          <ConnectorDefinitionCardUI
                            key={cd.id}
                            connectorDefinition={cd}
                            onConnect={handleConnect}
                          />
                        ))}
                      </Stack>
                    )
                  }
                </DataResult>
              </SyncTotal>
            )}
          </ConnectorDefinitionDataList>
        </Stack>
      </TabPanel>

      {selectedConnectorDefinitionId &&
        selectedSlug &&
        (() => {
          const WorkflowComponent = WORKFLOW_REGISTRY[selectedSlug];
          if (!WorkflowComponent) return null;
          return (
            <WorkflowComponent
              open={workflowOpen}
              onClose={handleCloseWorkflow}
              organizationId={organizationId}
              connectorDefinitionId={selectedConnectorDefinitionId}
            />
          );
        })()}

      <DeleteConnectorInstanceDialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setDeleteTarget(null);
        }}
        connectorInstanceName={deleteTarget?.name ?? ""}
        onConfirm={handleDeleteConfirm}
        isPending={deleteMutation.isPending}
        impact={impactQuery.data ?? null}
        isLoadingImpact={impactQuery.isLoading && deleteDialogOpen}
      />
    </Box>
  );
};
