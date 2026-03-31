import React, { useState, useCallback } from "react";

import type { CreatePortalBody } from "@portalai/core/contracts";
import {
  Box,
  Button,
  Icon,
  IconName,
  PageHeader,
  PageSection,
  Stack,
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
import { useAuthFetch, toServerError } from "../utils/api.util";

// ── Dashboard UI (pure) ─────────────────────────────────────────────

export interface DashboardViewUIProps {
  onNewPortal: () => void;
  onLaunchPortal: (stationId: string) => void;
  onChangeDefault: () => void;
  onViewStation: (stationId: string) => void;
  onPortalClick: (portalId: string) => void;
  onPinnedResultClick: (id: string) => void;
  onUnpinResult: (id: string) => void;
  onViewAllPinnedResults: () => void;
}

export const DashboardViewUI: React.FC<DashboardViewUIProps> = ({
  onNewPortal,
  onLaunchPortal,
  onChangeDefault,
  onViewStation,
  onPortalClick,
  onPinnedResultClick,
  onUnpinResult,
  onViewAllPinnedResults,
}) => (
  <Box>
    <Stack spacing={4}>
      <PageHeader
        breadcrumbs={[{ label: "Home" }]}
        title="Dashboard"
        icon={<Icon name={IconName.Home} />}
        primaryAction={
          <Button
            variant="contained"
            startIcon={<RocketLaunch />}
            onClick={onNewPortal}
          >
            Launch New Portal
          </Button>
        }
      >
        <HealthCheck showLabel />
      </PageHeader>

      <DefaultStationCardConnected
        onLaunchPortal={onLaunchPortal}
        onChangeDefault={onChangeDefault}
        onViewStation={onViewStation}
      />

      <PageSection title="Pinned Results" icon={<Icon name={IconName.PushPin} />}>
        <PinnedResultsListConnected
          onResultClick={onPinnedResultClick}
          onUnpin={onUnpinResult}
          onViewAll={onViewAllPinnedResults}
        />
      </PageSection>

      <PageSection title="Recent Portals" icon={<Icon name={IconName.RocketLaunch} />}>
        <RecentPortalsListConnected onPortalClick={onPortalClick} />
      </PageSection>
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

  const handleViewStation = useCallback(
    (stationId: string) => {
      navigate({ to: `/stations/${stationId}` });
    },
    [navigate]
  );

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
        onViewStation={handleViewStation}
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
        serverError={toServerError(createMutation.error)}
      />
    </>
  );
};
