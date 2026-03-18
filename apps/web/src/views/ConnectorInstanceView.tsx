import type {
  ConnectorEntityListRequestQuery,
  ConnectorEntityListWithMappingsResponsePayload,
  ConnectorInstanceGetResponsePayload,
} from "@portalai/core/contracts";
import { Box, Stack, Typography } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import { upperFirst } from "lodash-es";

import { ConnectorInstanceDataItem } from "../components/ConnectorInstance.component";
import {
  ConnectorEntityDataList,
  ConnectorEntityCardUI,
} from "../components/ConnectorEntity.component";
import DataResult from "../components/DataResult.component";
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

                  {/* Section 2: Entities List */}
                  <Box>
                    <Typography variant="h2" sx={{ mb: 2 }}>
                      Entities
                    </Typography>

                    <PaginationToolbar {...pagination.toolbarProps} />

                    <Box sx={{ mt: 2 }}>
                      <ConnectorEntityDataList
                        query={{
                          connectorInstanceId,
                          include: "fieldMappings" as const,
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
                </Stack>
              );
            }}
          </DataResult>
        )}
      </ConnectorInstanceDataItem>
    </Box>
  );
};
