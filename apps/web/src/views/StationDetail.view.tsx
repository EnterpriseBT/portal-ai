import React from "react";

import type {
  StationGetResponsePayload,
  PortalListRequestQuery,
  PortalListResponsePayload,
} from "@portalai/core/contracts";
import { Box, Breadcrumbs, Stack, Typography, IconName } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import { useNavigate } from "@tanstack/react-router";

import DataResult from "../components/DataResult.component";
import { SyncTotal } from "../components/SyncTotal.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";
import { sdk } from "../api/sdk";

// ── Station data item component ─────────────────────────────────────

interface StationDataItemProps {
  id: string;
  children: (data: ReturnType<typeof sdk.stations.get>) => React.ReactNode;
}

const StationDataItem: React.FC<StationDataItemProps> = ({ id, children }) => {
  const res = sdk.stations.get(id);
  return <>{children(res)}</>;
};

// ── Portal data list component ──────────────────────────────────────

interface PortalDataListProps {
  query: PortalListRequestQuery;
  children: (data: ReturnType<typeof sdk.portals.list>) => React.ReactNode;
}

const PortalDataList: React.FC<PortalDataListProps> = ({ query, children }) => {
  const res = sdk.portals.list(query);
  return <>{children(res)}</>;
};

// ── Station detail view ─────────────────────────────────────────────

interface StationDetailViewProps {
  stationId: string;
}

export const StationDetailView: React.FC<StationDetailViewProps> = ({
  stationId,
}) => {
  const navigate = useNavigate();

  const portalsPagination = usePagination({
    sortFields: [{ field: "created", label: "Created" }],
    defaultSortBy: "created",
    defaultSortOrder: "desc",
  });

  return (
    <Box>
      <StationDataItem id={stationId}>
        {(itemResult) => (
          <DataResult results={{ item: itemResult }}>
            {({ item }: { item: StationGetResponsePayload }) => {
              const station = item.station;
              return (
                <Stack spacing={4}>
                  <Breadcrumbs
                    items={[
                      { label: "Dashboard", href: "/", icon: IconName.Home },
                      { label: "Stations", href: "/stations" },
                      { label: station.name },
                    ]}
                    onNavigate={(href) => navigate({ to: href })}
                  />

                  {/* Metadata Section */}
                  <Box>
                    <Stack
                      direction="row"
                      spacing={2}
                      alignItems="center"
                      sx={{ mb: 2 }}
                    >
                      <Typography variant="h1">{station.name}</Typography>
                    </Stack>

                    <Stack spacing={1}>
                      {station.description && (
                        <Typography variant="body2" color="text.secondary">
                          {station.description}
                        </Typography>
                      )}
                      <Stack direction="row" spacing={0.5}>
                        {station.toolPacks.map((pack) => (
                          <Chip
                            key={pack}
                            label={pack}
                            size="small"
                            variant="outlined"
                          />
                        ))}
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        Created: {new Date(station.created).toLocaleString()}
                      </Typography>
                    </Stack>
                  </Box>

                  {/* Portals Section */}
                  <Box>
                    <Typography variant="h2" sx={{ mb: 2 }}>
                      Portals
                    </Typography>

                    <PaginationToolbar {...portalsPagination.toolbarProps} />

                    <Box sx={{ mt: 2 }}>
                      <PortalDataList
                        query={
                          {
                            stationId,
                            ...portalsPagination.queryParams,
                          } as PortalListRequestQuery
                        }
                      >
                        {(portalsResult) => (
                          <SyncTotal
                            total={portalsResult.data?.total}
                            setTotal={portalsPagination.setTotal}
                          >
                            <DataResult results={{ portals: portalsResult }}>
                              {({
                                portals,
                              }: {
                                portals: PortalListResponsePayload;
                              }) => {
                                if (portals.portals.length === 0) {
                                  return (
                                    <Typography
                                      variant="body1"
                                      color="text.secondary"
                                      sx={{ py: 4, textAlign: "center" }}
                                    >
                                      No portals yet
                                    </Typography>
                                  );
                                }

                                return (
                                  <Stack spacing={1}>
                                    {portals.portals.map((portal) => (
                                      <Card key={portal.id} variant="outlined">
                                        <CardActionArea
                                          onClick={() =>
                                            navigate({
                                              to: `/portals/${portal.id}`,
                                            })
                                          }
                                        >
                                          <CardContent
                                            sx={{ "&:last-child": { pb: 2 } }}
                                          >
                                            <Stack
                                              direction="row"
                                              justifyContent="space-between"
                                              alignItems="center"
                                            >
                                              <Typography variant="subtitle1">
                                                Portal
                                              </Typography>
                                              <Typography
                                                variant="caption"
                                                color="text.secondary"
                                              >
                                                {new Date(
                                                  portal.created
                                                ).toLocaleString()}
                                              </Typography>
                                            </Stack>
                                          </CardContent>
                                        </CardActionArea>
                                      </Card>
                                    ))}
                                  </Stack>
                                );
                              }}
                            </DataResult>
                          </SyncTotal>
                        )}
                      </PortalDataList>
                    </Box>
                  </Box>
                </Stack>
              );
            }}
          </DataResult>
        )}
      </StationDataItem>
    </Box>
  );
};
