import React, { useState, useCallback } from "react";

import type { CreatePortalBody } from "@portalai/core/contracts";
import {
  Box,
  Button,
  Icon,
  IconName,
  PageGrid,
  PageGridItem,
  PageHeader,
  PageSection,
  Stack,
} from "@portalai/core/ui";
import RocketLaunch from "@mui/icons-material/RocketLaunch";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { DefaultStationCardConnected } from "../components/DefaultStationCard.component";
import { RecentPortalsListConnected } from "../components/RecentPortalsList.component";
import { CreatePortalDialog } from "../components/CreatePortalDialog.component";
import { HealthCheck } from "../components/HealthCheck.component";
import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";

// ── Dashboard UI (pure) ─────────────────────────────────────────────

export interface DashboardViewUIProps {
  onNewPortal: () => void;
  onLaunchPortal: (stationId: string) => void;
  onChangeDefault: () => void;
  onViewStation: (stationId: string) => void;
  onPortalClick: (portalId: string) => void;
}

export const DashboardViewUI: React.FC<DashboardViewUIProps> = ({
  onNewPortal,
  onLaunchPortal,
  onChangeDefault,
  onViewStation,
  onPortalClick,
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

      <PageGrid columns={{ xs: 1, md: 2 }}>
        <PageGridItem span={{ xs: 1, md: 2 }}>
          <PageSection title="Recent Portals" icon={<Icon name={IconName.RocketLaunch} />}>
            <RecentPortalsListConnected onPortalClick={onPortalClick} />
          </PageSection>
        </PageGridItem>

        <PageGridItem>
          <PageSection title="Default Station" icon={<Icon name={IconName.SatelliteAlt} />}>
            <DefaultStationCardConnected
              onLaunchPortal={onLaunchPortal}
              onChangeDefault={onChangeDefault}
              onViewStation={onViewStation}
            />
          </PageSection>
        </PageGridItem>
      </PageGrid>
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

  return (
    <>
      <DashboardViewUI
        onNewPortal={handleNewPortal}
        onLaunchPortal={handleLaunchPortal}
        onChangeDefault={handleChangeDefault}
        onViewStation={handleViewStation}
        onPortalClick={handlePortalClick}
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
