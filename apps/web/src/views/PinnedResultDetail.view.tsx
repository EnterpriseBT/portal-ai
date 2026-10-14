import React, { useState, useCallback } from "react";

import type { PortalResult } from "@portalai/core/models";
import {
  Box,
  GatedButton,
  Icon,
  IconName,
  MetadataList,
  PageHeader,
  PageSection,
  Stack,
} from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";
import { ContentBlockRenderer } from "@portalai/core/ui";
import Alert from "@mui/material/Alert";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ShareIcon from "@mui/icons-material/IosShare";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PushPinIcon from "@mui/icons-material/PushPin";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import DataResult from "../components/DataResult.component";
import { decideActionGate } from "../utils/action-gate.util";
import { DeletePinnedResultDialog } from "../components/DeletePinnedResultDialog.component";
import { RenamePinnedResultDialog } from "../components/RenamePinnedResultDialog.component";
import { ShareDialog } from "../components/ShareDialog.component";
import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";
import { useToast } from "../utils/toast.context";
import type { PortalResultPayload } from "../api/portal-results.api";

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Reconstruct a block that ContentBlockRenderer can handle.
 * Pinned result content is stored exactly as the display block's content field,
 * so we pass it through directly.
 */
const toContentBlock = (
  result: PortalResult
): { type: string; content: unknown } => {
  return { type: result.type, content: result.content };
};

/** Type-chip labels — one entry per durable kind (#312). */
const TYPE_LABELS: Record<string, string> = {
  text: "Text",
  "data-table": "Table",
  d3: "Chart",
  geo: "Map",
};

/**
 * A pre-#312 pin that stored a bare handle envelope: its Redis handle is long
 * expired and no rows were materialized — render an explicit notice instead
 * of a silently empty table.
 */
const isSnapshotless = (result: PortalResult): boolean => {
  if (result.type !== "data-table" && result.type !== "d3") return false;
  const c = result.content as { queryHandle?: unknown; rows?: unknown };
  return typeof c?.queryHandle === "string" && !Array.isArray(c?.rows);
};

// ── Pure UI ─────────────────────────────────────────────────────────

export interface PinnedResultDetailUIProps {
  result: PortalResult;
  /** #621: per-object capabilities — gate Share / Rename / Delete+Unpin so a
   *  read-only grantee isn't shown an action that 403s. */
  canShare?: boolean;
  canWrite?: boolean;
  canDelete?: boolean;
  onShareClick?: () => void;
  /** Opens the rename dialog (owned by the container, #789). */
  onRenameClick: () => void;
  /** Opens the delete confirmation (owned by the container, #789). */
  onDeleteClick: () => void;
  onUnpin: () => void;
  /** The shared remove request (Unpin or Delete) is in flight: both actions
   *  are disabled until it settles (#789). */
  removing?: boolean;
  onOpenPortal: (portalId: string, messageId: string | null) => void;
  onNavigate: (href: string) => void;
}

export const PinnedResultDetailUI: React.FC<PinnedResultDetailUIProps> = ({
  result,
  canShare = false,
  canWrite = false,
  canDelete = false,
  onShareClick,
  onRenameClick,
  onDeleteClick,
  onUnpin,
  removing = false,
  onOpenPortal,
  onNavigate,
}) => {
  const contentBlock = toContentBlock(result);
  const removeGate = decideActionGate({
    allowed: canDelete,
    blocked: removing ? "Removing this pin…" : undefined,
  });

  return (
    <Box>
      <Stack spacing={4}>
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "Pinned Results", href: "/portal-results" },
            { label: result.name },
          ]}
          onNavigate={onNavigate}
          title={result.name}
          icon={<Icon name={IconName.PushPin} />}
          primaryAction={
            // #621/#690: Unpin removes the pin (a delete), so a read-only
            // grantee can view but not remove someone else's pin.
            <GatedButton
              variant="contained"
              size="small"
              startIcon={<PushPinIcon />}
              onClick={onUnpin}
              data-testid="unpin-btn"
              gate={removeGate}
            >
              Unpin
            </GatedButton>
          }
          secondaryActions={[
            // #621/#690: each action gated on the pin's server-computed
            // capabilities (owner/admin/creator, or a grant).
            {
              label: "Rename",
              icon: <EditIcon />,
              onClick: onRenameClick,
              gate: decideActionGate({ allowed: canWrite }),
            },
            {
              label: "Share",
              icon: <ShareIcon />,
              onClick: () => onShareClick?.(),
              gate: decideActionGate({ allowed: canShare && !!onShareClick }),
            },
            ...(result.portalId
              ? [
                  {
                    label: "Open Source Portal",
                    icon: <OpenInNewIcon />,
                    onClick: () =>
                      onOpenPortal(result.portalId!, result.messageId),
                  },
                ]
              : []),
            {
              label: "Delete",
              icon: <DeleteIcon />,
              onClick: onDeleteClick,
              color: "error" as const,
              gate: removeGate,
            },
          ]}
        >
          <MetadataList
            direction="vertical"
            layout="responsive"
            items={[
              {
                label: "Type",
                value: TYPE_LABELS[result.type] ?? result.type,
                variant: "chip",
              },
              {
                label: "Created",
                value: DateFactory.relativeTime(result.created),
              },
              // Portal/station delete detaches pins (tombstone copy) — say
              // so instead of silently dropping the source link (#312).
              ...(result.portalId == null
                ? [{ label: "Source", value: "Portal deleted" }]
                : []),
            ]}
          />
        </PageHeader>

        <PageSection variant="outlined" data-testid="result-content">
          {isSnapshotless(result) ? (
            <Alert severity="warning" data-testid="pinned-expired-notice">
              The saved data for this result has expired. Re-run the prompt and
              pin the fresh result.
            </Alert>
          ) : (
            <Box sx={{ overflow: "auto" }}>
              <ContentBlockRenderer
                block={contentBlock}
                // #690: a pin the caller can't write isn't refreshed (the
                // server would 403 the refresh).
                blockRef={{
                  kind: "pin",
                  portalResultId: result.id,
                  canRefresh: canWrite,
                }}
                dataUpdatedAt={result.snapshotUpdatedAt ?? result.created}
              />
            </Box>
          )}
        </PageSection>
      </Stack>
    </Box>
  );
};

// ── Container ───────────────────────────────────────────────────────

export interface PinnedResultDetailViewProps {
  portalResultId: string;
}

export const PinnedResultDetailView: React.FC<PinnedResultDetailViewProps> = ({
  portalResultId,
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const renameMutation = sdk.portalResults.rename(portalResultId);
  const removeMutation = sdk.portalResults.remove();

  // #789: each dialog stays open until its request succeeds; a failure shows
  // in its FormAlert. A reopened dialog starts without the last attempt's
  // error.
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const openRename = () => {
    renameMutation.reset();
    setRenameOpen(true);
  };

  const openDelete = () => {
    removeMutation.reset();
    setDeleteOpen(true);
  };

  const handleRename = useCallback(
    (name: string) => {
      renameMutation.mutate(
        { name },
        {
          onSuccess: () => {
            setRenameOpen(false);
            queryClient.invalidateQueries({
              queryKey: queryKeys.portalResults.root,
            });
          },
        }
      );
    },
    [renameMutation, queryClient]
  );

  const handleDeleteConfirm = useCallback(async () => {
    try {
      await removeMutation.mutateAsync({ id: portalResultId });
    } catch {
      // The dialog is still open: its FormAlert shows the failure.
      return;
    }
    setDeleteOpen(false);
    queryClient.invalidateQueries({ queryKey: queryKeys.portalResults.root });
    navigate({ to: "/portal-results" });
  }, [removeMutation, portalResultId, queryClient, navigate]);

  /**
   * Unpin removes the pin without a confirmation. It shares the remove
   * mutation with Delete (#286); with no dialog to hold a FormAlert, its
   * failure raises a toast.
   */
  const handleUnpin = useCallback(
    // Named so the Retry action can re-invoke it — referring to
    // `handleRemove` here would be a use-before-declaration.
    async function attempt(): Promise<void> {
      try {
        await removeMutation.mutateAsync({ id: portalResultId });
        queryClient.invalidateQueries({
          queryKey: queryKeys.portalResults.root,
        });
        navigate({ to: "/portal-results" });
      } catch {
        // Nothing to attach a FormAlert to once the confirm dialog closes, so
        // the failure raises a toast (CLAUDE.md → Toast Pattern). Staying on
        // the view is deliberate: the result still exists.
        toast.error("Could not remove this pinned result. Please try again.", {
          action: { label: "Retry", onClick: () => void attempt() },
        });
      }
    },
    [removeMutation, portalResultId, queryClient, navigate, toast]
  );

  const handleOpenPortal = useCallback(
    (portalId: string, messageId: string | null) => {
      navigate({
        to: `/portals/${portalId}`,
        ...(messageId ? { hash: messageId } : {}),
      });
    },
    [navigate]
  );

  const handleNavigate = useCallback(
    (href: string) => {
      navigate({ to: href });
    },
    [navigate]
  );

  // ── Live data (#312, simplified in #349) ──
  // There is no page-level refresh any more. It existed because `data-table`
  // was the one pinnable type with no widget-level refresh; #349 gave tables
  // their own chrome, so every refreshable pin type (data-table / d3 / geo)
  // now owns its cue, button, and degraded state via the pin `blockRef`
  // threaded down below. Keeping a page-level control duplicated the chrome
  // AND double-fired the mount auto-refresh against the per-org rate cap.
  const resultQuery = sdk.portalResults.get(portalResultId);
  const payload = resultQuery.data as PortalResultPayload | undefined;
  const portalResult = payload?.portalResult as PortalResult | undefined;
  // #688: the caller's capabilities on this pin (missing → fail closed).
  const capabilities = payload?.portalResult.capabilities;
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <DataResult results={{ result: resultQuery }}>
      {() => {
        if (!portalResult) return null;
        return (
          <>
            <PinnedResultDetailUI
              result={portalResult}
              canShare={capabilities?.share ?? false}
              canWrite={capabilities?.write ?? false}
              canDelete={capabilities?.delete ?? false}
              onShareClick={() => setShareOpen(true)}
              onRenameClick={openRename}
              onDeleteClick={openDelete}
              onUnpin={handleUnpin}
              removing={removeMutation.isPending}
              onOpenPortal={handleOpenPortal}
              onNavigate={handleNavigate}
            />
            {renameOpen && (
              <RenamePinnedResultDialog
                key={portalResult.name}
                open={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={portalResult.name}
                onSubmit={handleRename}
                isPending={renameMutation.isPending}
                serverError={toServerError(renameMutation.error)}
              />
            )}
            <DeletePinnedResultDialog
              open={deleteOpen}
              onClose={() => setDeleteOpen(false)}
              resultName={portalResult.name}
              onConfirm={() => void handleDeleteConfirm()}
              isPending={removeMutation.isPending}
              serverError={toServerError(removeMutation.error)}
            />
            <ShareDialog
              open={shareOpen}
              onClose={() => setShareOpen(false)}
              resourceType="pin"
              resourceId={portalResultId}
              resourceLabel={portalResult.name}
            />
          </>
        );
      }}
    </DataResult>
  );
};
