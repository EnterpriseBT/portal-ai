import React, { useState, useCallback } from "react";

import type { Station } from "@portalai/core/models";
import type {
  CreateStationBody,
  StationListRequestQuery,
} from "@portalai/core/contracts";
import {
  Box,
  GatedButton,
  Icon,
  IconName,
  PageHeader,
  Stack,
} from "@portalai/core/ui";
import type { ActionGate } from "@portalai/core/ui";
import AddIcon from "@mui/icons-material/Add";
import { useNavigate } from "@tanstack/react-router";

import { StationListConnected } from "../components/StationList.component";
import { CreateStationDialog } from "../components/CreateStationDialog.component";
import { DeleteStationDialog } from "../components/DeleteStationDialog.component";
import {
  usePagination,
  PaginationToolbar,
  type FilterConfig,
} from "../components/PaginationToolbar.component";
import { sdk, queryKeys } from "../api/sdk";
import { useBuiltinEntitlements } from "../utils/use-builtin-entitlements.util";
import { toServerError } from "../utils/api.util";
import { stationDeleteKeys } from "../utils/delete-invalidation.util";
import { useTagFilter } from "../utils/use-tag-filter.util";
import { FAVORITE_FILTER } from "../utils/favorite-filter.util";
import { useCreateGate } from "../utils/use-create-gate.util";
import { useCapabilities } from "../utils/use-capabilities.util";
import { useCreateParam } from "../utils/use-create-param.util";

// ── Stations list view (pure UI) ────────────────────────────────────

export interface StationsViewUIProps {
  onCreateStation: () => void;
  /** #1076: New Station is gated like every other create (#708). */
  createGate: ActionGate;
  onDelete: (station: Station) => void;
  /** #1070: the list's Tags filter, built by the container. */
  tagFilter: FilterConfig;
}

export const StationsViewUI: React.FC<StationsViewUIProps> = ({
  onCreateStation,
  createGate,
  onDelete,
  tagFilter,
}) => {
  const navigate = useNavigate();

  const pagination = usePagination({
    sortFields: [
      { field: "name", label: "Name" },
      { field: "created", label: "Created" },
    ],
    defaultSortBy: "name",
    defaultSortOrder: "asc",
    filters: [FAVORITE_FILTER, tagFilter],
  });

  return (
    <Box>
      <Stack spacing={4}>
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "Stations" },
          ]}
          onNavigate={(href) => navigate({ to: href })}
          title="Stations"
          icon={<Icon name={IconName.SatelliteAlt} />}
          primaryAction={
            createGate.kind === "hide" ? undefined : (
              <GatedButton
                gate={createGate}
                variant="contained"
                startIcon={<AddIcon />}
                onClick={onCreateStation}
              >
                New Station
              </GatedButton>
            )
          }
        />

        <PaginationToolbar {...pagination.toolbarProps} />

        <Box>
          <StationListConnected
            query={
              {
                ...pagination.queryParams,
                include: "tags",
              } as StationListRequestQuery
            }
            setTotal={pagination.setTotal}
            onDelete={onDelete}
            hasActiveFilters={pagination.isFiltered}
            favoritesOnly={pagination.isOnlyFilter(FAVORITE_FILTER.field)}
          />
        </Box>
      </Stack>
    </Box>
  );
};

// ── Container (wires hooks) ─────────────────────────────────────────

export const StationsView: React.FC = () => {
  const tagFilter = useTagFilter();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingStation, setDeletingStation] = useState<Station | null>(null);

  const createMutation = sdk.stations.create();
  const deleteMutation = sdk.stations.delete(deletingStation?.id ?? "");

  // #284: the create picker offers unentitled built-ins as disabled.
  const { entitledSlugs: entitledBuiltinSlugs, customPacksEntitled } =
    useBuiltinEntitlements();

  // Create
  const handleOpenCreate = useCallback(() => {
    setCreateOpen(true);
  }, []);
  const createGate = useCreateGate(
    "station",
    "Ask for access to create stations"
  );
  const { capabilitiesKnown } = useCapabilities();
  // #1076: `?create=station`, the command palette's New station.
  useCreateParam({
    gate: createGate,
    ready: capabilitiesKnown,
    onOpen: handleOpenCreate,
  });

  const handleCreateClose = useCallback(() => {
    setCreateOpen(false);
  }, []);

  const handleCreateSubmit = useCallback(
    (body: CreateStationBody) => {
      createMutation.mutate(body, {
        // #674: a create can attach views.
        invalidate: [queryKeys.stations.root, queryKeys.curatedViews.root],
        onSuccess: handleCreateClose,
      });
    },
    [createMutation, handleCreateClose]
  );

  // Delete
  const handleOpenDelete = useCallback((station: Station) => {
    setDeletingStation(station);
    setDeleteOpen(true);
  }, []);

  const handleDeleteClose = useCallback(() => {
    setDeleteOpen(false);
    setDeletingStation(null);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    deleteMutation.mutate(undefined, {
      // Its portals go with it, and their pins lose their portal link.
      invalidate: stationDeleteKeys(),
      onSuccess: handleDeleteClose,
    });
  }, [deleteMutation, handleDeleteClose]);

  return (
    <>
      <StationsViewUI
        onCreateStation={handleOpenCreate}
        createGate={createGate}
        onDelete={handleOpenDelete}
        tagFilter={tagFilter}
      />

      <CreateStationDialog
        entitledBuiltinSlugs={entitledBuiltinSlugs}
        customPacksEntitled={customPacksEntitled}
        open={createOpen}
        onClose={() => {
          createMutation.reset();
          handleCreateClose();
        }}
        onSubmit={handleCreateSubmit}
        isPending={createMutation.isPending}
        serverError={toServerError(createMutation.error)}
      />

      <DeleteStationDialog
        open={deleteOpen}
        onClose={() => {
          deleteMutation.reset();
          handleDeleteClose();
        }}
        station={deletingStation}
        onConfirm={handleDeleteConfirm}
        isPending={deleteMutation.isPending}
        serverError={toServerError(deleteMutation.error)}
      />
    </>
  );
};
