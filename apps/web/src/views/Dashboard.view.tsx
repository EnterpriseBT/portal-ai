import React, { useState, useCallback } from "react";

import { Icon, IconName, PageSection, Stack } from "@portalai/core/ui";
import { useQueryClient } from "@tanstack/react-query";

import { DashboardStartBox } from "../components/DashboardStartBox.component";
import { DashboardRecentPortals } from "../components/DashboardRecentPortals.component";
import { DashboardWorkbenchUI } from "../components/DashboardWorkbench.component";
import { PinnedResultsListConnected } from "../components/PinnedResultsList.component";
import { DeletePortalDialog } from "../components/DeletePortalDialog.component";
import { HealthCheck } from "../components/HealthCheck.component";
import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";
import { useToast } from "../utils/toast.context";

// ── Dashboard UI (pure) ─────────────────────────────────────────────

export interface DashboardViewUIProps {
  /** The start box (#1079), in the workbench's start slot. */
  startBox: React.ReactNode;
  /** The API health check, shown under the title. */
  healthCheck: React.ReactNode;
  /** The Recent portals body (its container fetches). */
  recentPortals: React.ReactNode;
  /** Today's Pinned Results list, until #1081's favorite pin tiles. */
  pinnedResults: React.ReactNode;
}

/**
 * The dashboard on the workbench layout (#1078). The start box (#1079) is
 * how a portal starts here; the header's launcher stays the shell's. Pinned
 * Results stays a section of its own after the workbench until #1081's
 * favorite pin tiles take the `pins` slot. Later children fill the other
 * slots. Pure: the container hands in each part that fetches.
 */
export const DashboardViewUI: React.FC<DashboardViewUIProps> = ({
  startBox,
  healthCheck,
  recentPortals,
  pinnedResults,
}) => (
  <Stack spacing={4}>
    <DashboardWorkbenchUI
      headerContent={healthCheck}
      start={startBox}
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
  const toast = useToast();
  const removeMutation = sdk.portalResults.remove();

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
        startBox={<DashboardStartBox />}
        healthCheck={<HealthCheck showLabel />}
        recentPortals={
          <DashboardRecentPortals onDeletePortal={handleDeletePortal} />
        }
        pinnedResults={<PinnedResultsListConnected onUnpin={handleUnpin} />}
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
