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
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { StationListConnected } from "../components/StationList.component";
import { CreateStationDialog } from "../components/CreateStationDialog.component";
import { DeleteStationDialog } from "../components/DeleteStationDialog.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";
import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";

// ── Stations list view (pure UI) ────────────────────────────────────

export interface StationsViewUIProps {
  onCreateStation: () => void;
  onSetDefault: (station: Station) => void;
  onOpen: (station: Station) => void;
  onDelete: (station: Station) => void;
}

export const StationsViewUI: React.FC<StationsViewUIProps> = ({
  onCreateStation,
  onSetDefault,
  onOpen,
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
          icon={<Icon name={IconName.RocketLaunch} />}
          primaryAction={
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={onCreateStation}
            >
              New Station
            </Button>
          }
        />

        <PaginationToolbar {...pagination.toolbarProps} />

        <Box>
          <StationListConnected
            query={pagination.queryParams as StationListRequestQuery}
            setTotal={pagination.setTotal}
            onSetDefault={onSetDefault}
            onOpen={onOpen}
            onDelete={onDelete}
            hasActiveFilters={!!(pagination.search || Object.values(pagination.filters).some(v => v.length > 0))}
          />
        </Box>
      </Stack>
    </Box>
  );
};

// ── Container (wires hooks) ─────────────────────────────────────────

export const StationsView: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingStation, setDeletingStation] = useState<Station | null>(null);

  const createMutation = sdk.stations.create();
  const deleteMutation = sdk.stations.delete(deletingStation?.id ?? "");

  // We need the org data to call setDefault — fetch it eagerly
  const orgResult = sdk.organizations.current();
  const orgId = orgResult.data?.organization.id ?? "";
  const setDefaultMutation = sdk.stations.setDefault(orgId);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.stations.root });
  }, [queryClient]);

  const invalidateOrg = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.organizations.root });
  }, [queryClient]);

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
        onSuccess: () => {
          handleCreateClose();
          invalidate();
        },
      });
    },
    [createMutation, handleCreateClose, invalidate]
  );

  // Set as default
  const handleSetDefault = useCallback(
    (station: Station) => {
      setDefaultMutation.mutate(
        { defaultStationId: station.id },
        {
          onSuccess: () => {
            invalidateOrg();
          },
        }
      );
    },
    [setDefaultMutation, invalidateOrg]
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
      onSuccess: () => {
        handleDeleteClose();
        invalidate();
        invalidateOrg();
        queryClient.invalidateQueries({ queryKey: queryKeys.portalResults.root });
      },
    });
  }, [deleteMutation, handleDeleteClose, invalidate, invalidateOrg, queryClient]);

  // Open station detail
  const handleOpen = useCallback(
    (station: Station) => {
      navigate({ to: `/stations/${station.id}` });
    },
    [navigate]
  );

  return (
    <>
      <StationsViewUI
        onCreateStation={handleOpenCreate}
        onSetDefault={handleSetDefault}
        onOpen={handleOpen}
        onDelete={handleOpenDelete}
      />

      <CreateStationDialog
        open={createOpen}
        onClose={handleCreateClose}
        onSubmit={handleCreateSubmit}
        isPending={createMutation.isPending}
        serverError={toServerError(createMutation.error)}
      />

      <DeleteStationDialog
        open={deleteOpen}
        onClose={handleDeleteClose}
        station={deletingStation}
        onConfirm={handleDeleteConfirm}
        isPending={deleteMutation.isPending}
        serverError={toServerError(deleteMutation.error)}
      />
    </>
  );
};
