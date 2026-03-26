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
import RocketLaunch from "@mui/icons-material/RocketLaunch";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { DefaultStationCardConnected } from "../components/DefaultStationCard.component";
import { PinnedResultsListConnected } from "../components/PinnedResultsList.component";
import { RecentPortalsListConnected } from "../components/RecentPortalsList.component";
import { CreatePortalDialog } from "../components/CreatePortalDialog.component";
import { HealthCheck } from "../components/HealthCheck.component";
import { sdk, queryKeys } from "../api/sdk";
import { useAuthFetch } from "../utils/api.util";

// ── Dashboard UI (pure) ─────────────────────────────────────────────

export interface DashboardViewUIProps {
  onNewPortal: () => void;
  onLaunchPortal: (stationId: string) => void;
  onChangeDefault: () => void;
  onPortalClick: (portalId: string) => void;
  onPinnedResultClick: (id: string) => void;
  onUnpinResult: (id: string) => void;
  onViewAllPinnedResults: () => void;
}

export const DashboardViewUI: React.FC<DashboardViewUIProps> = ({
  onNewPortal,
  onLaunchPortal,
  onChangeDefault,
  onPortalClick,
  onPinnedResultClick,
  onUnpinResult,
  onViewAllPinnedResults,
}) => (
  <Box>
    <Stack spacing={4}>
      <Box>
        <Breadcrumbs items={[{ label: "Home", icon: IconName.Home }]} />
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", sm: "center" }}
          spacing={1}
        >
          <Stack direction="row" alignItems="center" gap={1}>
            <HealthCheck />
            <Typography variant="h1">Dashboard</Typography>
          </Stack>
          <Button
            variant="contained"
            startIcon={<RocketLaunch />}
            onClick={onNewPortal}
          >
            Launch New Portal
          </Button>
        </Stack>
      </Box>

      <DefaultStationCardConnected
        onLaunchPortal={onLaunchPortal}
        onChangeDefault={onChangeDefault}
      />

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Pinned Results
        </Typography>
        <PinnedResultsListConnected
          onResultClick={onPinnedResultClick}
          onUnpin={onUnpinResult}
          onViewAll={onViewAllPinnedResults}
        />
      </Box>

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
  const { fetchWithAuth } = useAuthFetch();

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

  const handlePinnedResultClick = useCallback(
    (id: string) => {
      navigate({ to: `/portal-results/${id}` });
    },
    [navigate]
  );

  const handleUnpinResult = useCallback(
    async (id: string) => {
      await fetchWithAuth(
        `/api/portal-results/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      queryClient.invalidateQueries({
        queryKey: queryKeys.portalResults.root,
      });
    },
    [fetchWithAuth, queryClient]
  );

  const handleViewAllPinnedResults = useCallback(() => {
    navigate({ to: "/portal-results" });
  }, [navigate]);

  return (
    <>
      <DashboardViewUI
        onNewPortal={handleNewPortal}
        onLaunchPortal={handleLaunchPortal}
        onChangeDefault={handleChangeDefault}
        onPortalClick={handlePortalClick}
        onPinnedResultClick={handlePinnedResultClick}
        onUnpinResult={handleUnpinResult}
        onViewAllPinnedResults={handleViewAllPinnedResults}
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
