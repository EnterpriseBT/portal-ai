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
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { RecentPortalsListConnected } from "../components/RecentPortalsList.component";
import { PinnedResultsListConnected } from "../components/PinnedResultsList.component";
import { CreatePortalDialog } from "../components/CreatePortalDialog.component";
import { DeletePortalDialog } from "../components/DeletePortalDialog.component";
import { HealthCheck } from "../components/HealthCheck.component";
import { sdk, queryKeys } from "../api/sdk";
import { useAuthFetch, toServerError } from "../utils/api.util";
import type { ServerError } from "../utils/api.util";

// ── Dashboard UI (pure) ─────────────────────────────────────────────

export interface DashboardViewUIProps {
  onNewPortal: () => void;
  onPortalClick: (portalId: string) => void;
  onDeletePortal: (portalId: string, portalName: string) => void;
  onResultClick: (resultId: string) => void;
  onUnpin: (resultId: string) => void;
  onViewAllResults: () => void;
}

export const DashboardViewUI: React.FC<DashboardViewUIProps> = ({
  onNewPortal,
  onPortalClick,
  onDeletePortal,
  onResultClick,
  onUnpin,
  onViewAllResults,
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
            startIcon={<Icon name={IconName.Portal} />}
            onClick={onNewPortal}
          >
            Launch New Portal
          </Button>
        }
      >
        <HealthCheck showLabel />
      </PageHeader>

      <PageGrid columns={{ xs: 1 }}>
        <PageGridItem>
          <PageSection title="Recent Portals" icon={<Icon name={IconName.Portal} />}>
            <RecentPortalsListConnected
              onPortalClick={onPortalClick}
              onDeletePortal={onDeletePortal}
            />
          </PageSection>
        </PageGridItem>

        <PageGridItem>
          <PageSection title="Pinned Results" icon={<Icon name={IconName.PushPin} />}>
            <PinnedResultsListConnected
              onResultClick={onResultClick}
              onUnpin={onUnpin}
              onViewAll={onViewAllResults}
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
  const { fetchWithAuth } = useAuthFetch();

  // ── Create portal ───────────────────────────────────────────
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

  // ── Delete portal ───────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<ServerError | null>(null);

  const handleDeletePortal = useCallback(
    (portalId: string, portalName: string) => {
      setDeleteError(null);
      setDeleteTarget({ id: portalId, name: portalName });
    },
    []
  );

  const handleDeleteClose = useCallback(() => {
    setDeleteTarget(null);
    setDeleteError(null);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeletePending(true);
    try {
      await fetchWithAuth(
        `/api/portals/${encodeURIComponent(deleteTarget.id)}`,
        { method: "DELETE" }
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.portals.root });
      queryClient.invalidateQueries({ queryKey: queryKeys.portalResults.root });
      setDeleteTarget(null);
    } catch {
      setDeleteError({ message: "Failed to delete portal", code: "UNKNOWN" });
    } finally {
      setDeletePending(false);
    }
  }, [deleteTarget, fetchWithAuth, queryClient]);

  // ── Portal click ────────────────────────────────────────────
  const handlePortalClick = useCallback(
    (portalId: string) => {
      navigate({ to: `/portals/${portalId}` });
    },
    [navigate]
  );

  // ── Pinned results ──────────────────────────────────────────
  const handleResultClick = useCallback(
    (resultId: string) => {
      navigate({ to: `/portal-results/${resultId}` });
    },
    [navigate]
  );

  const handleUnpin = useCallback(
    async (resultId: string) => {
      await fetchWithAuth(
        `/api/portal-results/${encodeURIComponent(resultId)}`,
        { method: "DELETE" }
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.portalResults.root });
    },
    [fetchWithAuth, queryClient]
  );

  const handleViewAllResults = useCallback(() => {
    navigate({ to: "/portal-results" });
  }, [navigate]);

  return (
    <>
      <DashboardViewUI
        onNewPortal={handleNewPortal}
        onPortalClick={handlePortalClick}
        onDeletePortal={handleDeletePortal}
        onResultClick={handleResultClick}
        onUnpin={handleUnpin}
        onViewAllResults={handleViewAllResults}
      />

      <CreatePortalDialog
        open={createOpen}
        onClose={handleCreateClose}
        onSubmit={handleCreateSubmit}
        isPending={createMutation.isPending}
        serverError={toServerError(createMutation.error)}
      />

      <DeletePortalDialog
        open={deleteTarget !== null}
        onClose={handleDeleteClose}
        portalName={deleteTarget?.name ?? ""}
        onConfirm={handleDeleteConfirm}
        isPending={deletePending}
        serverError={deleteError}
      />
    </>
  );
};
