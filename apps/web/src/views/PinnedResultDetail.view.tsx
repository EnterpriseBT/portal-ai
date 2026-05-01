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
import { useAuthFetch } from "../utils/api.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import type { PortalResultPayload } from "../api/portal-results.api";

// ── Data fetcher ────────────────────────────────────────────────────

interface ResultDataProps {
  id: string;
  children: (data: ReturnType<typeof sdk.portalResults.get>) => React.ReactNode;
}

const ResultData: React.FC<ResultDataProps> = ({ id, children }) => {
  const res = sdk.portalResults.get(id);
  return <>{children(res)}</>;
};

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
                value: result.type === "vega-lite" ? "Chart" : "Text",
                variant: "chip",
              },
              {
                label: "Created",
                value: DateFactory.relativeTime(result.created),
              },
            ]}
          />
        </PageHeader>

        <PageSection variant="outlined" data-testid="result-content">
          <Box sx={{ overflow: "auto" }}>
            <ContentBlockRenderer block={contentBlock} />
          </Box>
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
  const { fetchWithAuth } = useAuthFetch();

  const renameMutation = sdk.portalResults.rename(portalResultId);

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

  const handleDelete = useCallback(async () => {
    await fetchWithAuth(
      `/api/portal-results/${encodeURIComponent(portalResultId)}`,
      { method: "DELETE" }
    );
    queryClient.invalidateQueries({
      queryKey: queryKeys.portalResults.root,
    });
    navigate({ to: "/portal-results" });
  }, [fetchWithAuth, portalResultId, queryClient, navigate]);

  const handleUnpin = useCallback(async () => {
    await fetchWithAuth(
      `/api/portal-results/${encodeURIComponent(portalResultId)}`,
      { method: "DELETE" }
    );
    queryClient.invalidateQueries({
      queryKey: queryKeys.portalResults.root,
    });
    navigate({ to: "/portal-results" });
  }, [fetchWithAuth, portalResultId, queryClient, navigate]);

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

  return (
    <ResultData id={portalResultId}>
      {(result) => (
        <DataResult results={{ result }}>
          {(data) => {
            const payload = data.result as unknown as PortalResultPayload;
            const portalResult =
              payload.portalResult as unknown as PortalResult;
            return (
              <PinnedResultDetailUI
                result={portalResult}
                onRename={handleRename}
                onDelete={handleDelete}
                onUnpin={handleUnpin}
                onOpenPortal={handleOpenPortal}
                onNavigate={handleNavigate}
                renamePending={renameMutation.isPending}
              />
            );
          }}
        </DataResult>
      )}
    </ResultData>
  );
};
