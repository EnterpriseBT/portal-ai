import React, { useState, useCallback } from "react";

import type {
  StationGetResponsePayload,
  UpdateStationBody,
  PortalListRequestQuery,
  PortalListResponsePayload,
} from "@portalai/core/contracts";
import { Box, Button, Icon, IconName, MetadataList, PageEmptyState, PageHeader, PageSection, Stack, Typography } from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";
import Chip from "@mui/material/Chip";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import HandymanOutlined from "@mui/icons-material/HandymanOutlined";
import MemoryOutlined from "@mui/icons-material/MemoryOutlined";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import DataResult from "../components/DataResult.component";
import { PortalCardUI } from "../components/PortalCard.component";
import { DeletePortalDialog } from "../components/DeletePortalDialog.component";
import { DeleteStationDialog } from "../components/DeleteStationDialog.component";
import { EditStationDialog } from "../components/EditStationDialog.component";
import { SyncTotal } from "../components/SyncTotal.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";
import { sdk, queryKeys } from "../api/sdk";
import { useAuthFetch, toServerError } from "../utils/api.util";

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
        queryClient.invalidateQueries({ queryKey: queryKeys.portals.root });
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
                    <PageHeader
                      breadcrumbs={[
                        { label: "Dashboard", href: "/" },
                        { label: "Stations", href: "/stations" },
                        { label: station.name },
                      ]}
                      onNavigate={(href) => navigate({ to: href })}
                      title={station.name}
                      icon={<Icon name={IconName.SatelliteAlt} />}
                      primaryAction={
                        <Button
                          variant="contained"
                          startIcon={<RocketLaunchIcon />}
                          onClick={handleLaunchPortal}
                          disabled={createPortalMutation.isPending}
                        >
                          {createPortalMutation.isPending ? "Opening..." : "Open Portal"}
                        </Button>
                      }
                      secondaryActions={[
                        { label: "Edit", icon: <EditIcon />, onClick: () => setEditOpen(true) },
                        { label: "Delete", icon: <DeleteIcon />, onClick: () => setDeleteStationOpen(true), color: "error" },
                      ]}
                    >
                      {station.description && (
                        <Typography variant="body2" color="text.secondary">
                          {station.description}
                        </Typography>
                      )}
                      <MetadataList
                        items={[
                          {
                            label: "Tool Packs",
                            value: (
                              <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75 }}>
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
                            ),
                            variant: "chip",
                            hidden: station.toolPacks.length === 0,
                          },
                          {
                            label: "Connectors",
                            value: (
                              <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75 }}>
                                {(station.instances ?? []).map((inst) => (
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
                            ),
                            variant: "chip",
                            hidden: (station.instances ?? []).length === 0,
                          },
                          { label: "Created", value: DateFactory.relativeTime(station.created) },
                        ]}
                      />
                    </PageHeader>


                    {/* Portals Section */}
                    <PageSection title="Portals" icon={<Icon name={IconName.RocketLaunch} />}>
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
                                      <PageEmptyState
                                        icon={<Icon name={IconName.RocketLaunch} />}
                                        title="No portals yet"
                                      />
                                    );
                                  }

                                  return (
                                    <Stack spacing={1}>
                                      {portals.portals.map((portal) => (
                                        <PortalCardUI
                                          key={portal.id}
                                          id={portal.id}
                                          name={portal.name}
                                          created={portal.created}
                                          onClick={(id) =>
                                            navigate({ to: `/portals/${id}` })
                                          }
                                          onDelete={(id) =>
                                            setDeleteTarget({
                                              id,
                                              name: portal.name,
                                            })
                                          }
                                        />
                                      ))}
                                    </Stack>
                                  );
                                }}
                              </DataResult>
                            </SyncTotal>
                          )}
                        </PortalDataList>
                      </Box>
                    </PageSection>
                  </Stack>
                  {editOpen && (
                    <EditStationDialog
                      key={stationId}
                      open={editOpen}
                      onClose={() => setEditOpen(false)}
                      station={station}
                      onSubmit={handleEditSubmit}
                      isPending={updateMutation.isPending}
                      serverError={toServerError(updateMutation.error)}
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
