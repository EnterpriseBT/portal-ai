import { useCallback, useState } from "react";
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
import type { ConnectorDefinitionListRequestQuery } from "@portalai/core/contracts";

import {
  ConnectorDefinitionCardUI,
  ConnectorDefinitionDataList,
} from "../components/ConnectorDefinition.component";
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

const WORKFLOW_REGISTRY: Record<string, ComponentType<ConnectorWorkflowProps>> = {
  csv: CSVConnectorWorkflow,
};

export const ConnectorView = () => {
  const { tabsProps, getTabProps, getTabPanelProps } = useTabs();

  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [selectedConnectorDefinitionId, setSelectedConnectorDefinitionId] = useState<string | null>(null);
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

  const pagination = usePagination({
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
        <Typography>Connected connectors</Typography>
      </TabPanel>
      <TabPanel {...getTabPanelProps(1)}>
        <Stack spacing={2}>
          <PaginationToolbar {...pagination.toolbarProps} />
          <ConnectorDefinitionDataList
            query={
              pagination.queryParams as ConnectorDefinitionListRequestQuery
            }
          >
            {(response) => (
              <SyncTotal
                total={response.data?.total}
                setTotal={pagination.setTotal}
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

      {selectedConnectorDefinitionId && selectedSlug && (() => {
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
