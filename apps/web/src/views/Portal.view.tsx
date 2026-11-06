import React, { useState, useCallback } from "react";

import type { PortalGetResponsePayload } from "@portalai/core/contracts";
import { Box, GatedButton, PageHeader } from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import DataResult from "../components/DataResult.component";
import { HttpError } from "../components/HttpError.component";
import { DeletePortalDialog } from "../components/DeletePortalDialog.component";
import { PortalHeaderMeta } from "../components/PortalHeaderMeta.component";
import { PortalSession } from "../components/PortalSession.component";
import { RenamePortalDialog } from "../components/RenamePortalDialog.component";
import { sdk, queryKeys } from "../api/sdk";
import { ApiError, toServerError } from "../utils/api.util";
import { decideActionGate } from "../utils/action-gate.util";

// #971: the same params PortalSession reads with, so the view and the session
// share one cache entry and one request rather than fetching the row twice.
const PORTAL_QUERY_PARAMS = { include: "pinnedResults" } as const;

interface PortalViewProps {
  portalId: string;
}

export const PortalView: React.FC<PortalViewProps> = ({ portalId }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const renameMutation = sdk.portals.rename(portalId);
  const removeMutation = sdk.portals.remove(portalId);
  const touchMutation = sdk.portals.touch(portalId);
  // #690: the portal's capabilities decide the header's actions and whether
  // opening the portal records lastOpened.
  const portalQuery = sdk.portals.get(portalId, PORTAL_QUERY_PARAMS);
  const canWrite = portalQuery.data?.portal.capabilities.write ?? false;
  // #971: the chat mounts only for a portal that exists and is readable. No
  // data yet (loading, or a deleted/unreadable portal's 404) means no chat. A
  // 404 on a later refetch means it's gone now, so the chat unmounts. Any other
  // refetch error keeps the cached portal, and the live chat with it.
  const portalGone =
    portalQuery.error instanceof ApiError && portalQuery.error.status === 404;
  const showPortal = portalQuery.data !== undefined && !portalGone;
  // The header follows the same rule, so a transient refetch error can't swap
  // it for an error page above a live chat.
  const headerResult = showPortal
    ? { ...portalQuery, isError: false, error: null }
    : portalQuery;

  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Update lastOpened when the portal view is visited, only for a caller who
  // may write it (#690: an owner/admin viewing someone else's portal doesn't).
  // #783: an effect reads the promise, not per-call callbacks. Under
  // StrictMode the effect runs twice: one timestamp per visit makes the second
  // run's body identical, so it joins the first request (one PATCH), and the
  // list is refreshed once per request. The refresh still runs after leaving
  // the page, so the dashboard shows the new lastOpened.
  const openedAt = React.useRef<{ portalId: string; at: number } | null>(null);
  const touchRequest = React.useRef<Promise<unknown> | null>(null);
  React.useEffect(() => {
    if (!canWrite) return;
    if (openedAt.current?.portalId !== portalId) {
      openedAt.current = { portalId, at: DateFactory.now() };
    }
    const request = touchMutation.mutateAsync({
      lastOpened: openedAt.current.at,
    });
    if (touchRequest.current === request) return;
    touchRequest.current = request;
    request
      .then(() =>
        queryClient.invalidateQueries({ queryKey: queryKeys.portals.root })
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit; touchMutation and queryClient are stable enough and re-running on their identity would re-touch
  }, [portalId, canWrite]);

  const handleRenameSubmit = useCallback(
    (name: string) => {
      renameMutation.mutate(
        { name },
        {
          onSuccess: () => {
            setRenameOpen(false);
            queryClient.invalidateQueries({ queryKey: queryKeys.portals.root });
          },
        }
      );
    },
    [renameMutation, queryClient]
  );

  const handleDeleteConfirm = useCallback(() => {
    removeMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.portals.root });
        queryClient.invalidateQueries({
          queryKey: queryKeys.portalResults.root,
        });
        navigate({ to: "/" });
      },
    });
  }, [removeMutation, queryClient, navigate]);

  return (
    <Box display="flex" flexDirection="column" flex={1} minHeight={0}>
      <DataResult
        results={{ item: headerResult }}
        options={{
          item: {
            // #971: the page is full-screen, so the error state carries its own
            // way out (the chat's Exit is gone with the chat).
            renderError: () => (
              <HttpError
                statusCode={portalGone ? 404 : 500}
                title={
                  portalGone ? "Portal not found" : "Couldn't load this portal"
                }
                description={
                  portalGone
                    ? "It may have been deleted, or you may not have access to it."
                    : "Something went wrong loading this portal. Try again in a moment."
                }
              />
            ),
          },
        }}
      >
        {({ item }: { item: PortalGetResponsePayload }) => (
          <>
            <Box
              sx={{
                flexShrink: 0,
                px: { xs: 2, sm: 4 },
                pt: 2,
                pb: 1,
                borderBottom: 1,
                borderColor: "divider",
              }}
            >
              <PageHeader
                title={item.portal.name}
                primaryAction={
                  <GatedButton
                    size="small"
                    variant="contained"
                    startIcon={<EditIcon />}
                    onClick={() => {
                      // A failed rename's error belongs to that attempt,
                      // not the next opening.
                      renameMutation.reset();
                      setRenameOpen(true);
                    }}
                    gate={decideActionGate({
                      allowed: item.portal.capabilities.write,
                    })}
                  >
                    Rename
                  </GatedButton>
                }
                secondaryActions={[
                  {
                    label: "Delete",
                    icon: <DeleteIcon />,
                    onClick: () => setDeleteOpen(true),
                    color: "error",
                    gate: decideActionGate({
                      allowed: item.portal.capabilities.delete,
                    }),
                  },
                ]}
              >
                <PortalHeaderMeta stationId={item.portal.stationId} />
              </PageHeader>
            </Box>

            {renameOpen && (
              <RenamePortalDialog
                key={item.portal.name}
                open={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={item.portal.name}
                onSubmit={handleRenameSubmit}
                isPending={renameMutation.isPending}
                serverError={toServerError(renameMutation.error)}
              />
            )}

            <DeletePortalDialog
              open={deleteOpen}
              onClose={() => {
                removeMutation.reset();
                setDeleteOpen(false);
              }}
              portalName={item.portal.name}
              onConfirm={handleDeleteConfirm}
              isPending={removeMutation.isPending}
              serverError={toServerError(removeMutation.error)}
            />
          </>
        )}
      </DataResult>
      {showPortal && <PortalSession portalId={portalId} />}
    </Box>
  );
};
