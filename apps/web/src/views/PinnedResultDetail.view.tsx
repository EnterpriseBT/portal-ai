import React, { useState, useCallback } from "react";

import type { PortalResult } from "@portalai/core/models";
import {
  Box,
  Button,
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
import TextField from "@mui/material/TextField";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PushPinIcon from "@mui/icons-material/PushPin";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import DataResult from "../components/DataResult.component";
import { sdk, queryKeys } from "../api/sdk";
import { useToast } from "../utils/toast.context";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
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
  onRename: (name: string) => void;
  onDelete: () => void;
  onUnpin: () => void;
  onOpenPortal: (portalId: string, messageId: string | null) => void;
  onNavigate: (href: string) => void;
  renamePending?: boolean;
}

export const PinnedResultDetailUI: React.FC<PinnedResultDetailUIProps> = ({
  result,
  onRename,
  onDelete,
  onUnpin,
  onOpenPortal,
  onNavigate,
  renamePending,
}) => {
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(result.name);
  const renameRef = useDialogAutoFocus(renameOpen);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleRenameSubmit = () => {
    if (renameValue.trim()) {
      onRename(renameValue.trim());
      setRenameOpen(false);
    }
  };

  const handleDeleteConfirm = () => {
    setDeleteOpen(false);
    onDelete();
  };

  const contentBlock = toContentBlock(result);

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
            <Button
              variant="contained"
              size="small"
              startIcon={<PushPinIcon />}
              onClick={onUnpin}
              data-testid="unpin-btn"
            >
              Unpin
            </Button>
          }
          secondaryActions={[
            {
              label: "Rename",
              icon: <EditIcon />,
              onClick: () => {
                setRenameValue(result.name);
                setRenameOpen(true);
              },
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
              onClick: () => setDeleteOpen(true),
              color: "error" as const,
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
                blockRef={{ kind: "pin", portalResultId: result.id }}
                dataUpdatedAt={result.snapshotUpdatedAt ?? result.created}
              />
            </Box>
          )}
        </PageSection>
      </Stack>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)}>
        <DialogTitle>Rename Result</DialogTitle>
        <DialogContent>
          <TextField
            inputRef={renameRef}
            fullWidth
            margin="dense"
            label="Name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit();
            }}
            data-testid="rename-input"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameOpen(false)}>Cancel</Button>
          <Button
            onClick={handleRenameSubmit}
            variant="contained"
            disabled={renamePending || !renameValue.trim()}
            data-testid="rename-submit"
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <DialogTitle>Delete Pinned Result</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete &quot;{result.name}&quot;? This
            action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
            data-testid="delete-confirm"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
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

  const handleRename = useCallback(
    (name: string) => {
      renameMutation.mutate(
        { name },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: queryKeys.portalResults.root,
            });
          },
        }
      );
    },
    [renameMutation, queryClient]
  );

  /**
   * One handler behind both affordances. "Unpin" and "Delete" (the latter
   * behind a confirm dialog) are the same operation on this view — they were
   * two byte-identical hand-rolled fetches before #286. The two props stay:
   * they are distinct affordances, they just no longer duplicate the request.
   */
  const handleRemove = useCallback(
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
  const portalResult = (
    resultQuery.data as unknown as PortalResultPayload | undefined
  )?.portalResult as PortalResult | undefined;

  return (
    <DataResult results={{ result: resultQuery }}>
      {() => {
        if (!portalResult) return null;
        return (
          <PinnedResultDetailUI
            result={portalResult}
            onRename={handleRename}
            onDelete={handleRemove}
            onUnpin={handleRemove}
            onOpenPortal={handleOpenPortal}
            onNavigate={handleNavigate}
            renamePending={renameMutation.isPending}
          />
        );
      }}
    </DataResult>
  );
};
