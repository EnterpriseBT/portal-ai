import React, { useState, useCallback } from "react";

import type {
  StationGetResponsePayload,
  UpdateStationBody,
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
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import HandymanOutlined from "@mui/icons-material/HandymanOutlined";
import MemoryOutlined from "@mui/icons-material/MemoryOutlined";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import DataResult from "../components/DataResult.component";
import { DeletePortalDialog } from "../components/DeletePortalDialog.component";
import { DeleteStationDialog } from "../components/DeleteStationDialog.component";
import { EditStationDialog } from "../components/EditStationDialog.component";
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
  const res = sdk.stations.get(id, { include: "connectorInstance" });
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
  const createPortalMutation = sdk.portals.create();
  const updateMutation = sdk.stations.update(stationId);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteStationOpen, setDeleteStationOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const deleteStationMutation = sdk.stations.delete(stationId);

  const handleEditSubmit = useCallback(
    (body: UpdateStationBody) => {
      updateMutation.mutate(body, {
        onSuccess: () => {
          setEditOpen(false);
          queryClient.invalidateQueries({ queryKey: queryKeys.stations.root });
        },
      });
    },
    [updateMutation, queryClient]
  );

  const handleDeleteStation = useCallback(() => {
    deleteStationMutation.mutate(undefined, {
      onSuccess: () => {
        setDeleteStationOpen(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.stations.root });
        navigate({ to: "/stations" });
      },
    });
  }, [deleteStationMutation, queryClient, navigate]);

  const handleLaunchPortal = useCallback(() => {
    createPortalMutation.mutate(
      { stationId },
      {
        onSuccess: (data) => {
          queryClient.invalidateQueries({ queryKey: queryKeys.portals.root });
          navigate({ to: `/portals/${data.portal.id}` });
        },
      }
    );
  }, [createPortalMutation, stationId, queryClient, navigate]);

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
                <>
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
                        direction={{ xs: "column", sm: "row" }}
                        spacing={2}
                        alignItems={{ xs: "flex-start", sm: "center" }}
                        justifyContent="space-between"
                        sx={{ mb: 2 }}
                      >
                        <Typography variant="h1">{station.name}</Typography>
                        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                          <Button
                            variant="outlined"
                            startIcon={<EditIcon />}
                            onClick={() => setEditOpen(true)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="outlined"
                            color="error"
                            startIcon={<DeleteOutlineIcon />}
                            onClick={() => setDeleteStationOpen(true)}
                          >
                            Delete
                          </Button>
                          <Button
                            variant="contained"
                            startIcon={<RocketLaunchIcon />}
                            onClick={handleLaunchPortal}
                            disabled={createPortalMutation.isPending}
                          >
                            {createPortalMutation.isPending ? "Opening..." : "Open Portal"}
                          </Button>
                        </Stack>
                      </Stack>
                      <Box>
                        {/* Metadata Section */}
                        <Stack spacing={1}>
                          {station.description && (
                            <Typography variant="body2" color="text.secondary">
                              {station.description}
                            </Typography>
                          )}
                          <Stack direction="row" spacing={0.5} flexWrap="wrap">
                            {station.toolPacks.map((pack) => (
                              <Chip
                                key={pack}
                                icon={<HandymanOutlined fontSize="small" />}
                                label={pack}
                                size="small"
                                variant="outlined"
                              />
                            ))}
                          </Stack>
                          {(station.instances ?? []).length > 0 && (
                            <Stack direction="row" spacing={0.5} flexWrap="wrap">
                              {station.instances!.map((inst) => (
                                <Chip
                                  key={inst.id}
                                  icon={<MemoryOutlined fontSize="small" />}
                                  label={inst.connectorInstance?.name ?? inst.connectorInstanceId}
                                  size="small"
                                  variant="outlined"
                                  color="primary"
                                />
                              ))}
                            </Stack>
                          )}
                          <Typography variant="body2" color="text.secondary">
                            Created: {DateFactory.relativeTime(station.created)}
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
                  {editOpen && (
                    <EditStationDialog
                      key={stationId}
                      open={editOpen}
                      onClose={() => setEditOpen(false)}
                      station={station}
                      onSubmit={handleEditSubmit}
                      isPending={updateMutation.isPending}
                      serverError={updateMutation.error?.message ?? null}
                    />
                  )}
                  <DeleteStationDialog
                    open={deleteStationOpen}
                    onClose={() => setDeleteStationOpen(false)}
                    station={station}
                    onConfirm={handleDeleteStation}
                    isPending={deleteStationMutation.isPending}
                  />
                </>
              );
            }}
          </DataResult>
        )}
      </StationDataItem>

      <DeletePortalDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        portalName={deleteTarget?.name ?? ""}
        onConfirm={handleConfirmDelete}
      />
    </Box>
  );
};
