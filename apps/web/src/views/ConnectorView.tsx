import { useCallback, useMemo, useState } from "react";
import type { ComponentType } from "react";

import {
  Box,
  Stack,
  Tab,
  TabPanel,
  Tabs,
  Typography,
  useTabs,
} from "@portalai/core/ui";
import type { ConnectorDefinition } from "@portalai/core/models";
import type {
  ConnectorDefinitionListRequestQuery,
  ConnectorInstanceApi,
  ConnectorInstanceListRequestQuery,
} from "@portalai/core/contracts";
import { useNavigate } from "@tanstack/react-router";

import {
  ConnectorDefinitionCardUI,
  ConnectorDefinitionDataList,
} from "../components/ConnectorDefinition.component";
import {
  ConnectorInstanceCardUI,
  ConnectorInstanceDataList,
} from "../components/ConnectorInstance.component";
import DataResult from "../components/DataResult.component";
import { EmptyResults } from "../components/EmptyResults.component";
import {
  PaginationToolbar,
  usePagination,
} from "../components/PaginationToolbar.component";
import { SyncTotal } from "../components/SyncTotal.component";
import { sdk } from "../api/sdk";
import { CSVConnectorWorkflow } from "../workflows/CSVConnector";

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
};

export const ConnectorView = () => {
  const { tabsProps, getTabProps, getTabPanelProps } = useTabs();
  const navigate = useNavigate();

  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [selectedConnectorDefinitionId, setSelectedConnectorDefinitionId] =
    useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

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
        type: "select",
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

  // Bulk-fetch all definitions for icon/display lookup
  const { data: allDefinitionsData } = sdk.connectorDefinitions.list({
    limit: 1000,
    offset: 0,
    sortBy: "display",
    sortOrder: "asc",
  });

  const definitionMap = useMemo(() => {
    const map = new Map<string, ConnectorDefinition>();
    if (allDefinitionsData?.connectorDefinitions) {
      for (const cd of allDefinitionsData.connectorDefinitions) {
        map.set(cd.id, cd);
      }
    }
    return map;
  }, [allDefinitionsData]);

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
      <Typography variant="h1">Connectors</Typography>
      <Tabs {...tabsProps}>
        <Tab label="Connected" {...getTabProps(0)} />
        <Tab label="Catalog" {...getTabProps(1)} />
      </Tabs>

      <TabPanel {...getTabPanelProps(0)}>
        <Stack spacing={2}>
          <PaginationToolbar {...instancePagination.toolbarProps} />
          <ConnectorInstanceDataList
            query={
              instancePagination.queryParams as ConnectorInstanceListRequestQuery
            }
          >
            {(response) => (
              <SyncTotal
                total={response.data?.total}
                setTotal={instancePagination.setTotal}
              >
                <DataResult results={{ connectorInstances: response }}>
                  {({ connectorInstances }) =>
                    connectorInstances.total === 0 ? (
                      <EmptyResults />
                    ) : (
                      <Stack spacing={1}>
                        {connectorInstances.connectorInstances.map((ci) => (
                          <ConnectorInstanceCardUI
                            key={ci.id}
                            connectorInstance={ci}
                            connectorDefinition={definitionMap.get(
                              ci.connectorDefinitionId
                            )}
                            onClick={handleInstanceClick}
                          />
                        ))}
                      </Stack>
                    )
                  }
                </DataResult>
              </SyncTotal>
            )}
          </ConnectorInstanceDataList>
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
                      <EmptyResults />
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
    </Box>
  );
};
