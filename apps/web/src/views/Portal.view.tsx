import React, { useState, useCallback } from "react";

import type { PortalGetResponsePayload } from "@portalai/core/contracts";
import { Box, Button, Modal, Stack, Typography } from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";
import TextField from "@mui/material/TextField";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import DataResult from "../components/DataResult.component";
import { PortalSession } from "../components/PortalSession.component";
import { sdk, queryKeys } from "../api/sdk";

// ── Portal data item component ──────────────────────────────────────

interface PortalDataItemProps {
  id: string;
  children: (data: ReturnType<typeof sdk.portals.get>) => React.ReactNode;
}

const PortalDataItem: React.FC<PortalDataItemProps> = ({ id, children }) => {
  const res = sdk.portals.get(id);
  return <>{children(res)}</>;
};

// ── Rename dialog ───────────────────────────────────────────────────

interface RenamePortalDialogProps {
  open: boolean;
  onClose: () => void;
  currentName: string;
  onSubmit: (name: string) => void;
  isPending: boolean;
}

const RenamePortalDialog: React.FC<RenamePortalDialogProps> = ({
  open,
  onClose,
  currentName,
  onSubmit,
  isPending,
}) => {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState("");

  const handleSubmit = () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (name.trim() === currentName) {
      onClose();
      return;
    }
    onSubmit(name.trim());
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rename Portal"
      maxWidth="sm"
      fullWidth
      actions={
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={isPending}
          >
            {isPending ? "Saving..." : "Save"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError("");
          }}
          error={!!error}
          helperText={error}
          required
          fullWidth
          autoFocus
        />
      </Stack>
    </Modal>
  );
};

// ── Delete dialog ───────────────────────────────────────────────────

interface DeletePortalDialogProps {
  open: boolean;
  onClose: () => void;
  portalName: string;
  onConfirm: () => void;
  isPending: boolean;
}

const DeletePortalDialog: React.FC<DeletePortalDialogProps> = ({
  open,
  onClose,
  portalName,
  onConfirm,
  isPending,
}) => (
  <Modal
    open={open}
    onClose={onClose}
    title="Delete Portal"
    maxWidth="sm"
    fullWidth
    actions={
      <Stack direction="row" spacing={1}>
        <Button variant="outlined" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={onConfirm}
          disabled={isPending}
        >
          {isPending ? "Deleting..." : "Delete"}
        </Button>
      </Stack>
    }
  >
    <Stack spacing={2} sx={{ pt: 1 }}>
      <Typography variant="body1">
        Are you sure you want to delete <strong>{portalName}</strong>?
      </Typography>
      <Typography variant="body2" color="warning.main">
        All messages will be permanently deleted. Pinned results will not be
        affected. This action cannot be undone.
      </Typography>
    </Stack>
  </Modal>
);

// ── Portal view ─────────────────────────────────────────────────────

interface PortalViewProps {
  portalId: string;
}

export const PortalView: React.FC<PortalViewProps> = ({ portalId }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const renameMutation = sdk.portals.rename(portalId);
  const removeMutation = sdk.portals.remove(portalId);

  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
        navigate({ to: "/" });
      },
    });
  }, [removeMutation, queryClient, navigate]);

  return (
    <Box display="flex" flexDirection="column" flex={1} minHeight={0}>
      <PortalDataItem id={portalId}>
        {(itemResult) => (
          <DataResult results={{ item: itemResult }}>
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
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    alignItems={{ xs: "flex-start", sm: "center" }}
                    justifyContent="space-between"
                    spacing={{ xs: 1, sm: 0 }}
                  >
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={{ xs: 0.25, sm: 1 }}
                      alignItems={{ xs: "flex-start", sm: "baseline" }}
                      sx={{ minWidth: 0 }}
                    >
                      <Typography
                        variant="h6"
                        noWrap
                        sx={{ minWidth: 0, maxWidth: "100%" }}
                      >
                        {item.portal.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ flexShrink: 0 }}
                      >
                        Created{" "}
                        {DateFactory.relativeTime(item.portal.created)}
                      </Typography>
                    </Stack>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ flexShrink: 0, width: { xs: "100%", sm: "auto" } }}
                    >
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<EditIcon />}
                        onClick={() => setRenameOpen(true)}
                      >
                        Rename
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        startIcon={<DeleteIcon />}
                        onClick={() => setDeleteOpen(true)}
                      >
                        Delete
                      </Button>
                    </Stack>
                  </Stack>
                </Box>

                {renameOpen && (
                  <RenamePortalDialog
                    key={item.portal.name}
                    open={renameOpen}
                    onClose={() => setRenameOpen(false)}
                    currentName={item.portal.name}
                    onSubmit={handleRenameSubmit}
                    isPending={renameMutation.isPending}
                  />
                )}

                <DeletePortalDialog
                  open={deleteOpen}
                  onClose={() => setDeleteOpen(false)}
                  portalName={item.portal.name}
                  onConfirm={handleDeleteConfirm}
                  isPending={removeMutation.isPending}
                />
              </>
            )}
          </DataResult>
        )}
      </PortalDataItem>
      <PortalSession portalId={portalId} />
    </Box>
  );
};
