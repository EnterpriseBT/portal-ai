import React, { useState, useCallback } from "react";

import type { CreatePortalBody } from "@portalai/core/contracts";
import { Button, Icon, IconName, PageSection, Stack } from "@portalai/core/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { DashboardRecentPortals } from "../components/DashboardRecentPortals.component";
import { DashboardWorkbenchUI } from "../components/DashboardWorkbench.component";
import { PinnedResultsListConnected } from "../components/PinnedResultsList.component";
import { CreatePortalDialog } from "../components/CreatePortalDialog.component";
import { DeletePortalDialog } from "../components/DeletePortalDialog.component";
import { HealthCheck } from "../components/HealthCheck.component";
import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";
import { useToast } from "../utils/toast.context";

// ── Dashboard UI (pure) ─────────────────────────────────────────────

export interface DashboardViewUIProps {
  onNewPortal: () => void;
  /** The API health check, shown under the title. */
  healthCheck: React.ReactNode;
  /** The Recent portals body (its container fetches). */
  recentPortals: React.ReactNode;
  /** Today's Pinned Results list, until #1081's favorite pin tiles. */
  pinnedResults: React.ReactNode;
}

/**
 * The dashboard on the workbench layout (#1078). The header keeps Open Portal
 * until #1079's start box takes the `start` slot, and Pinned Results stays a
 * section of its own after the workbench until #1081's favorite pin tiles
 * take the `pins` slot. Later children fill the other slots. Pure: the
 * container hands in each part that fetches.
 */
export const DashboardViewUI: React.FC<DashboardViewUIProps> = ({
  onNewPortal,
  healthCheck,
  recentPortals,
  pinnedResults,
}) => (
  <Stack spacing={4}>
    <DashboardWorkbenchUI
      headerAction={
        <Button
          variant="contained"
          startIcon={<Icon name={IconName.Portal} />}
          onClick={onNewPortal}
        >
          Open Portal
        </Button>
      }
      headerContent={healthCheck}
      recent={recentPortals}
    />
    <PageSection title="Pinned Results" icon={<Icon name={IconName.PushPin} />}>
      {pinnedResults}
    </PageSection>
  </Stack>
);

// ── Container (wires hooks) ─────────────────────────────────────────

export const DashboardView: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const removeMutation = sdk.portalResults.remove();

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
        invalidate: [queryKeys.portals.root],
        onSuccess: (data) => {
          handleCreateClose();
          navigate({ to: `/portals/${data.portal.id}` });
        },
      });
    },
    [createMutation, handleCreateClose, navigate]
  );

  // ── Delete portal ───────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  // #690: through the SDK, bound to the current target (was a raw fetch).
  const {
    mutate: deletePortal,
    isPending: deletePending,
    error: deleteError,
    reset: resetDelete,
  } = sdk.portals.remove(deleteTarget?.id ?? "");

  const handleDeletePortal = useCallback(
    (portalId: string, portalName: string) => {
      resetDelete();
      setDeleteTarget({ id: portalId, name: portalName });
    },
    [resetDelete]
  );

  const handleDeleteClose = useCallback(() => {
    setDeleteTarget(null);
    resetDelete();
  }, [resetDelete]);

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteTarget) return;
    deletePortal(undefined, {
      invalidate: [queryKeys.portals.root, queryKeys.portalResults.root],
      onSuccess: () => setDeleteTarget(null),
    });
  }, [deleteTarget, deletePortal]);

  // #312 (closes the UNPIN_SDK_BYPASS remainder): unpin routes through the
  // SDK; failures raise a persistent toast with Retry (Toast Pattern).
  const handleUnpin = useCallback(
    async function attempt(resultId: string): Promise<void> {
      try {
        await removeMutation.mutateAsync({ id: resultId });
        queryClient.invalidateQueries({
          queryKey: queryKeys.portalResults.root,
        });
      } catch {
        toast.error("Could not remove this pinned result. Please try again.", {
          action: { label: "Retry", onClick: () => void attempt(resultId) },
        });
      }
    },
    [removeMutation, queryClient, toast]
  );

  return (
    <>
      <DashboardViewUI
        onNewPortal={handleNewPortal}
        healthCheck={<HealthCheck showLabel />}
        recentPortals={
          <DashboardRecentPortals onDeletePortal={handleDeletePortal} />
        }
        pinnedResults={<PinnedResultsListConnected onUnpin={handleUnpin} />}
      />

      <CreatePortalDialog
        open={createOpen}
        onClose={() => {
          createMutation.reset();
          handleCreateClose();
        }}
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
        serverError={toServerError(deleteError)}
      />
    </>
  );
};
