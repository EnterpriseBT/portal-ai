import React, { useState, useCallback } from "react";

import type { Station } from "@portalai/core/models";
import type {
  CreateStationBody,
  StationListRequestQuery,
} from "@portalai/core/contracts";
import {
  Box,
  Button,
  Icon,
  IconName,
  PageHeader,
  Stack,
} from "@portalai/core/ui";
import AddIcon from "@mui/icons-material/Add";
import { useNavigate } from "@tanstack/react-router";

import { DefaultStationMeta } from "../components/DefaultStationMeta.component";
import { StationListConnected } from "../components/StationList.component";
import { CreateStationDialog } from "../components/CreateStationDialog.component";
import { DeleteStationDialog } from "../components/DeleteStationDialog.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";
import { sdk, queryKeys } from "../api/sdk";
import { useBuiltinEntitlements } from "../utils/use-builtin-entitlements.util";
import { toServerError } from "../utils/api.util";

// ── Stations list view (pure UI) ────────────────────────────────────

export interface StationsViewUIProps {
  onCreateStation: () => void;
  onSetDefault: (station: Station) => void;
  onDelete: (station: Station) => void;
}

export const StationsViewUI: React.FC<StationsViewUIProps> = ({
  onCreateStation,
  onSetDefault,
  onDelete,
}) => {
  const navigate = useNavigate();

  const pagination = usePagination({
    sortFields: [
      { field: "name", label: "Name" },
      { field: "created", label: "Created" },
    ],
    defaultSortBy: "name",
    defaultSortOrder: "asc",
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
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={onCreateStation}
            >
              New Station
            </Button>
          }
        >
          <DefaultStationMeta />
        </PageHeader>

        <PaginationToolbar {...pagination.toolbarProps} />

        <Box>
          <StationListConnected
            query={pagination.queryParams as StationListRequestQuery}
            setTotal={pagination.setTotal}
            onSetDefault={onSetDefault}
            onDelete={onDelete}
            hasActiveFilters={
              !!(
                pagination.search ||
                Object.values(pagination.filters).some((v) => v.length > 0)
              )
            }
          />
        </Box>
      </Stack>
    </Box>
  );
};

// ── Container (wires hooks) ─────────────────────────────────────────

export const StationsView: React.FC = () => {
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingStation, setDeletingStation] = useState<Station | null>(null);

  const createMutation = sdk.stations.create();
  const deleteMutation = sdk.stations.delete(deletingStation?.id ?? "");

  // We need the org data to call setDefault — fetch it eagerly
  const orgResult = sdk.organizations.current();
  const orgId = orgResult.data?.organization.id ?? "";
  // #284: the create picker offers unentitled built-ins as disabled.
  const { entitledSlugs: entitledBuiltinSlugs } = useBuiltinEntitlements();
  const setDefaultMutation = sdk.stations.setDefault(orgId);

  // Create
  const handleOpenCreate = useCallback(() => {
    setCreateOpen(true);
  }, []);

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

  // Set as default
  const handleSetDefault = useCallback(
    (station: Station) => {
      setDefaultMutation.mutate(
        { defaultStationId: station.id },
        { invalidate: [queryKeys.organizations.root] }
      );
    },
    [setDefaultMutation]
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
      invalidate: [
        queryKeys.stations.root,
        queryKeys.organizations.root,
        queryKeys.portalResults.root,
      ],
      onSuccess: handleDeleteClose,
    });
  }, [deleteMutation, handleDeleteClose]);

  return (
    <>
      <StationsViewUI
        onCreateStation={handleOpenCreate}
        onSetDefault={handleSetDefault}
        onDelete={handleOpenDelete}
      />

      <CreateStationDialog
        entitledBuiltinSlugs={entitledBuiltinSlugs}
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
