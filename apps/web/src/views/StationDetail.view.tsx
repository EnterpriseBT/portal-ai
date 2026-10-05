import React, { useState, useCallback } from "react";

import type {
  StationGetResponsePayload,
  UpdateStationBody,
  PortalListRequestQuery,
  PortalListResponsePayload,
} from "@portalai/core/contracts";
import {
  Box,
  Button,
  Icon,
  IconName,
  MetadataList,
  PageEmptyState,
  PageHeader,
  PageSection,
  Stack,
  Typography,
} from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ShareIcon from "@mui/icons-material/IosShare";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import DataResult from "../components/DataResult.component";
import { PortalCardUI } from "../components/PortalCard.component";
import { DeletePortalDialog } from "../components/DeletePortalDialog.component";
import { DeleteStationDialog } from "../components/DeleteStationDialog.component";
import { EditStationDialog } from "../components/EditStationDialog.component";
import { ShareDialog } from "../components/ShareDialog.component";
import { StationAttachmentAlertsUI } from "../components/StationAttachmentAlerts.component";
import { StationAttachmentListUI } from "../components/StationAttachmentList.component";
import { SyncTotal } from "../components/SyncTotal.component";
import { ToolPackChipWithMetadata } from "../components/ToolPackChipWithMetadata.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";
import { sdk, queryKeys } from "../api/sdk";
import { useBuiltinEntitlements } from "../utils/use-builtin-entitlements.util";
import { toServerError } from "../utils/api.util";
import { decideActionGate } from "../utils/action-gate.util";
import { useToast } from "../utils/toast.context";
import { toStationAttachmentItems } from "../utils/station-attachments.util";

// ── Station data item component ─────────────────────────────────────

interface StationDataItemProps {
  id: string;
  children: (data: ReturnType<typeof sdk.stations.get>) => React.ReactNode;
}

const StationDataItem: React.FC<StationDataItemProps> = ({ id, children }) => {
  // #674: both attachment kinds, each with canRead.
  const res = sdk.stations.get(id, {
    include: "connectorInstance,curatedView",
  });
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
  const toast = useToast();
  const createPortalMutation = sdk.portals.create();
  const updateMutation = sdk.stations.update(stationId);
  const orgResult = sdk.organizations.current();
  const defaultStationId =
    orgResult.data?.organization.defaultStationId ?? null;
  // #284: one read drives both the attached-pack chips and the edit picker.
  const { entitledSlugs: entitledBuiltinSlugs, isEntitled } =
    useBuiltinEntitlements();
  const isDefaultStation = defaultStationId === stationId;

  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteStationOpen, setDeleteStationOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  // #690: through the SDK, bound to the current target (was a raw fetch).
  const {
    mutate: deletePortal,
    isPending: deletePortalPending,
    error: deletePortalError,
    reset: resetDeletePortal,
  } = sdk.portals.remove(deleteTarget?.id ?? "");

  const deleteStationMutation = sdk.stations.delete(stationId);

  const handleEditSubmit = useCallback(
    (body: UpdateStationBody) => {
      updateMutation.mutate(body, {
        onSuccess: () => {
          setEditOpen(false);
          queryClient.invalidateQueries({ queryKey: queryKeys.stations.root });
          // #674: the station's view attachments changed too.
          queryClient.invalidateQueries({
            queryKey: queryKeys.curatedViews.root,
          });
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
      // The confirm dialog has no FormAlert, so a failure (e.g. a 403 or a
      // job lock) must surface as a toast rather than fail silently (#621).
      onError: (error) => {
        setDeleteStationOpen(false);
        toast.error(
          toServerError(error)?.message ?? "Could not delete this station."
        );
      },
    });
  }, [deleteStationMutation, queryClient, navigate, toast]);

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

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    deletePortal(undefined, {
      onSuccess: () => {
        // A portal's pins go with it (cascade), so pins refetch too.
        queryClient.invalidateQueries({ queryKey: queryKeys.portals.root });
        queryClient.invalidateQueries({
          queryKey: queryKeys.portalResults.root,
        });
        setDeleteTarget(null);
      },
    });
  };

  const portalsPagination = usePagination({
    sortFields: [
      { field: "lastOpened", label: "Last Opened" },
      { field: "created", label: "Created" },
    ],
    defaultSortBy: "lastOpened",
    defaultSortOrder: "desc",
  });

  return (
    <Box>
      <StationDataItem id={stationId}>
        {(itemResult) => (
          <DataResult results={{ item: itemResult }}>
            {({ item }: { item: StationGetResponsePayload }) => {
              const station = item.station;
              const attachments = toStationAttachmentItems(station);
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
                          startIcon={<Icon name={IconName.Portal} />}
                          onClick={handleLaunchPortal}
                          disabled={createPortalMutation.isPending}
                        >
                          {createPortalMutation.isPending
                            ? "Opening..."
                            : "Open Portal"}
                        </Button>
                      }
                      secondaryActions={[
                        // #621/#688: each action is gated on its server-computed
                        // capability (owner/admin/creator, or a grant) — never a
                        // client role check. A read-only grantee sees none of
                        // Share/Edit/Delete rather than an action that 403s.
                        {
                          label: "Share",
                          icon: <ShareIcon />,
                          onClick: () => setShareOpen(true),
                          gate: decideActionGate({
                            allowed: item.station.capabilities.share,
                          }),
                        },
                        {
                          label: "Edit",
                          icon: <EditIcon />,
                          onClick: () => setEditOpen(true),
                          gate: decideActionGate({
                            allowed: item.station.capabilities.write,
                          }),
                        },
                        {
                          label: "Delete",
                          icon: <DeleteIcon />,
                          onClick: () => setDeleteStationOpen(true),
                          color: "error" as const,
                          gate: decideActionGate({
                            allowed: item.station.capabilities.delete,
                          }),
                        },
                      ]}
                    >
                      {station.description && (
                        <Typography variant="body2" color="text.secondary">
                          {station.description}
                        </Typography>
                      )}
                      <MetadataList
                        direction="vertical"
                        layout="responsive"
                        items={[
                          {
                            label: "Tool Packs",
                            value: (
                              <Stack
                                direction="row"
                                sx={{ flexWrap: "wrap", gap: 0.75 }}
                              >
                                {(station.enabledToolpacks ?? []).map(
                                  (pack: string) => (
                                    <ToolPackChipWithMetadata
                                      key={pack}
                                      pack={pack}
                                      entitled={isEntitled(pack)}
                                    />
                                  )
                                )}
                              </Stack>
                            ),
                            variant: "chip",
                            hidden:
                              (station.enabledToolpacks ?? []).length === 0,
                          },
                          // #674: both rows always show (— when empty);
                          // the attachment alert below says why.
                          {
                            label: "Connectors",
                            value: (
                              <StationAttachmentListUI
                                kind="connector"
                                items={attachments.connectors}
                              />
                            ),
                            variant: "chip",
                          },
                          {
                            label: "Views",
                            value: (
                              <StationAttachmentListUI
                                kind="view"
                                items={attachments.views}
                              />
                            ),
                            variant: "chip",
                          },
                          {
                            label: "Created",
                            value: DateFactory.relativeTime(station.created),
                          },
                          {
                            label: "Organization Default",
                            value: "Yes",
                            hidden: !isDefaultStation,
                          },
                        ]}
                      />
                      <StationAttachmentAlertsUI
                        viewCount={attachments.views.length}
                        connectorCount={attachments.connectors.length}
                      />
                    </PageHeader>

                    {/* Portals Section */}
                    <PageSection
                      title="Portals"
                      icon={<Icon name={IconName.Portal} />}
                    >
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
                                        icon={<Icon name={IconName.Portal} />}
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
                                          lastOpened={portal.lastOpened}
                                          canDelete={portal.capabilities.delete}
                                          onClick={(id) =>
                                            navigate({ to: `/portals/${id}` })
                                          }
                                          onDelete={(id) => {
                                            // A previous portal's failed delete
                                            // mustn't show in this one's dialog.
                                            resetDeletePortal();
                                            setDeleteTarget({
                                              id,
                                              name: portal.name,
                                            });
                                          }}
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
                      entitledBuiltinSlugs={entitledBuiltinSlugs}
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
                  <ShareDialog
                    open={shareOpen}
                    onClose={() => setShareOpen(false)}
                    resourceType="station"
                    resourceId={stationId}
                    resourceLabel={station.name}
                  />
                </>
              );
            }}
          </DataResult>
        )}
      </StationDataItem>

      <DeletePortalDialog
        open={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null);
          resetDeletePortal();
        }}
        portalName={deleteTarget?.name ?? ""}
        onConfirm={handleConfirmDelete}
        isPending={deletePortalPending}
        serverError={toServerError(deletePortalError)}
      />
    </Box>
  );
};
