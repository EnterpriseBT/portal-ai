import React, { useState, useCallback } from "react";

import type { PortalGetResponsePayload } from "@portalai/core/contracts";
import {
  Box,
  Button,
  GatedButton,
  Modal,
  PageHeader,
  Stack,
} from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";
import TextField from "@mui/material/TextField";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import DataResult from "../components/DataResult.component";
import { DeletePortalDialog } from "../components/DeletePortalDialog.component";
import { FormAlert } from "../components/FormAlert.component";
import { PortalHeaderMeta } from "../components/PortalHeaderMeta.component";
import { PortalSession } from "../components/PortalSession.component";
import { sdk, queryKeys } from "../api/sdk";
import { toServerError, type ServerError } from "../utils/api.util";
import { focusFirstInvalidField } from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import { decideActionGate } from "../utils/action-gate.util";

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
  serverError?: ServerError | null;
}

const RenamePortalDialog: React.FC<RenamePortalDialogProps> = ({
  open,
  onClose,
  currentName,
  onSubmit,
  isPending,
  serverError,
}) => {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState("");
  const nameRef = useDialogAutoFocus(open);

  const handleSubmit = () => {
    if (!name.trim()) {
      setError("Name is required");
      requestAnimationFrame(() => focusFirstInvalidField());
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
          inputRef={nameRef}
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
        />
        <FormAlert serverError={serverError ?? null} />
      </Stack>
    </Modal>
  );
};

// ── Portal view ─────────────────────────────────────────────────────

interface PortalViewProps {
  portalId: string;
}

export const PortalView: React.FC<PortalViewProps> = ({ portalId }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const renameMutation = sdk.portals.rename(portalId);
  const removeMutation = sdk.portals.remove(portalId);
  const touchMutation = sdk.portals.touch(portalId);
  // #690: the same cached query PortalDataItem reads. Its capabilities decide
  // the header's actions and whether opening the portal records lastOpened.
  const canWrite =
    sdk.portals.get(portalId).data?.portal.capabilities.write ?? false;

  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Update lastOpened when the portal view is visited, only for a caller who
  // may write it (#690: an owner/admin viewing someone else's portal doesn't).
  React.useEffect(() => {
    if (!canWrite) return;
    touchMutation.mutate(
      { lastOpened: DateFactory.now() },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.portals.root });
        },
      }
    );
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
                  <PageHeader
                    title={item.portal.name}
                    primaryAction={
                      <GatedButton
                        size="small"
                        variant="contained"
                        startIcon={<EditIcon />}
                        onClick={() => setRenameOpen(true)}
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
                  onClose={() => setDeleteOpen(false)}
                  portalName={item.portal.name}
                  onConfirm={handleDeleteConfirm}
                  isPending={removeMutation.isPending}
                  serverError={toServerError(removeMutation.error)}
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
