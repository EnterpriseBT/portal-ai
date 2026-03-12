import {
  Box,
  Stack,
  Tab,
  TabPanel,
  Tabs,
  Typography,
  useTabs,
} from "@mcp-ui/core/ui";
import {
  ConnectorDefinitionCard,
  ConnectorDefinitionDataList,
} from "../components/ConnectorDefinition.component";
import DataResult from "../components/DataResult.component";
import { EmptyResults } from "../components/EmptyResults.component";
import {
  PaginationToolbar,
  usePagination,
} from "../components/PaginationToolbar.component";
import { SyncTotal } from "../components/SyncTotal.component";
import type { ConnectorDefinitionListRequestQuery } from "@mcp-ui/core/contracts";

export const ConnectorView = () => {
  const { tabsProps, getTabProps, getTabPanelProps } = useTabs();

  const pagination = usePagination({
    defaultSortBy: "display",
    defaultSortOrder: "asc",
    limit: 10,
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
                        {connectorDefinitions.connectorDefinitions.map(
                          (cd) => (
                            <ConnectorDefinitionCard
                              key={cd.id}
                              connectorDefinition={cd}
                            />
                          )
                        )}
                      </Stack>
                    )
                  }
                </DataResult>
              </SyncTotal>
            )}
          </ConnectorDefinitionDataList>
        </Stack>
      </TabPanel>
    </Box>
  );
};
