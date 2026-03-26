import React, { useState, useCallback } from "react";

import type { CreatePortalBody } from "@portalai/core/contracts";
import {
  Box,
  Breadcrumbs,
  Button,
  Stack,
  Typography,
  IconName,
} from "@portalai/core/ui";
import AddIcon from "@mui/icons-material/Add";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { DefaultStationCardConnected } from "../components/DefaultStationCard.component";
import { RecentPortalsListConnected } from "../components/RecentPortalsList.component";
import { CreatePortalDialog } from "../components/CreatePortalDialog.component";
import { HealthCheck } from "../components/HealthCheck.component";
import { sdk, queryKeys } from "../api/sdk";

// ── Dashboard UI (pure) ─────────────────────────────────────────────

export interface DashboardViewUIProps {
  onNewPortal: () => void;
  onLaunchPortal: (stationId: string) => void;
  onChangeDefault: () => void;
  onPortalClick: (portalId: string) => void;
}

export const DashboardViewUI: React.FC<DashboardViewUIProps> = ({
  onNewPortal,
  onLaunchPortal,
  onChangeDefault,
  onPortalClick,
}) => (
  <Box>
    <Stack spacing={4}>
      <Box>
        <Breadcrumbs items={[{ label: "Dashboard", icon: IconName.Home }]} />
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <Stack direction="row" alignItems="center" gap={1}>
            <HealthCheck />
            <Typography variant="h1">Dashboard</Typography>
          </Stack>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={onNewPortal}
          >
            New Portal
          </Button>
        </Stack>
      </Box>

      <DefaultStationCardConnected
        onLaunchPortal={onLaunchPortal}
        onChangeDefault={onChangeDefault}
      />

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Recent Portals
        </Typography>
        <RecentPortalsListConnected onPortalClick={onPortalClick} />
      </Box>
    </Stack>
  </Box>
);

// ── Container (wires hooks) ─────────────────────────────────────────

export const DashboardView: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [createOpen, setCreateOpen] = useState(false);
  const createMutation = sdk.portals.create();

  const handleNewPortal = useCallback(() => {
    setCreateOpen(true);
  }, []);

  const handleCreateClose = useCallback(() => {
    setCreateOpen(false);
  }, []);

  const handleCreateSubmit = useCallback(
    (body: CreatePortalBody) => {
      createMutation.mutate(body, {
        onSuccess: (data) => {
          handleCreateClose();
          queryClient.invalidateQueries({ queryKey: queryKeys.portals.root });
          navigate({ to: `/portals/${data.portal.id}` });
        },
      });
    },
    [createMutation, handleCreateClose, queryClient, navigate]
  );

  const handleLaunchPortal = useCallback(
    (stationId: string) => {
      createMutation.mutate(
        { stationId },
        {
          onSuccess: (data) => {
            queryClient.invalidateQueries({
              queryKey: queryKeys.portals.root,
            });
            navigate({ to: `/portals/${data.portal.id}` });
          },
        }
      );
    },
    [createMutation, queryClient, navigate]
  );

  const handleChangeDefault = useCallback(() => {
    navigate({ to: "/stations" });
  }, [navigate]);

  const handlePortalClick = useCallback(
    (portalId: string) => {
      navigate({ to: `/portals/${portalId}` });
    },
    [navigate]
  );

  return (
    <>
      <DashboardViewUI
        onNewPortal={handleNewPortal}
        onLaunchPortal={handleLaunchPortal}
        onChangeDefault={handleChangeDefault}
        onPortalClick={handlePortalClick}
      />

      <CreatePortalDialog
        open={createOpen}
        onClose={handleCreateClose}
        onSubmit={handleCreateSubmit}
        isPending={createMutation.isPending}
        serverError={createMutation.error?.message ?? null}
      />
    </>
  );
};
