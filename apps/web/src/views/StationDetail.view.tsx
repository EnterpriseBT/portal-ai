import React, { useState, useCallback } from "react";

import type {
  StationGetResponsePayload,
  PortalListRequestQuery,
  PortalListResponsePayload,
} from "@portalai/core/contracts";
import { Box, Breadcrumbs, Button, Stack, Typography, IconName } from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";
import Chip from "@mui/material/Chip";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import DataResult from "../components/DataResult.component";
import { SyncTotal } from "../components/SyncTotal.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";
import { sdk, queryKeys } from "../api/sdk";
import { useAuthFetch } from "../utils/api.util";

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
  const queryClient = useQueryClient();
  const { fetchWithAuth } = useAuthFetch();

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    await fetchWithAuth(
      `/api/portals/${encodeURIComponent(deleteTarget.id)}`,
      { method: "DELETE" }
    );
    queryClient.invalidateQueries({
      queryKey: queryKeys.portals.root,
    });
    setDeleteTarget(null);
  }, [deleteTarget, fetchWithAuth, queryClient]);

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
                  <Box>
                    <Breadcrumbs
                      items={[
                        { label: "Dashboard", href: "/", icon: IconName.Home },
                        { label: "Stations", href: "/stations" },
                        { label: station.name },
                      ]}
                      onNavigate={(href) => navigate({ to: href })}
                    />
                    <Stack
                      direction="row"
                      spacing={2}
                      alignItems="center"
                      sx={{ mb: 2 }}
                    >
                      <Typography variant="h1">{station.name}</Typography>
                    </Stack>
                    <Box>
                      {/* Metadata Section */}
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
                                        <Stack direction="row" alignItems="center">
                                          <CardActionArea
                                            onClick={() =>
                                              navigate({
                                                to: `/portals/${portal.id}`,
                                              })
                                            }
                                            sx={{ flex: 1, minWidth: 0 }}
                                          >
                                            <CardContent
                                              sx={{ "&:last-child": { pb: 2 } }}
                                            >
                                              <Stack
                                                direction="row"
                                                justifyContent="space-between"
                                                alignItems="center"
                                              >
                                                <Typography variant="subtitle1" noWrap>
                                                  {portal.name}
                                                </Typography>
                                                <Typography
                                                  variant="caption"
                                                  color="text.secondary"
                                                  sx={{ ml: 2, flexShrink: 0 }}
                                                >
                                                  {DateFactory.relativeTime(portal.created)}
                                                </Typography>
                                              </Stack>
                                            </CardContent>
                                          </CardActionArea>
                                          <Tooltip title="Delete portal">
                                            <IconButton
                                              size="small"
                                              color="error"
                                              onClick={() => setDeleteTarget({ id: portal.id, name: portal.name })}
                                              sx={{ mr: 1 }}
                                              data-testid={`delete-portal-${portal.id}`}
                                            >
                                              <DeleteOutlineIcon fontSize="small" />
                                            </IconButton>
                                          </Tooltip>
                                        </Stack>
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

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete Portal</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete &quot;{deleteTarget?.name}&quot;?
            This will permanently remove the portal and all associated unpinned
            messages. Pinned results will not be affected.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button
            onClick={handleConfirmDelete}
            color="error"
            variant="contained"
            data-testid="confirm-delete-portal"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
