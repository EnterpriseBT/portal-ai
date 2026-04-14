import React, { useState, useCallback } from "react";

import type { PortalGetResponsePayload } from "@portalai/core/contracts";
import { Box, Button, Icon, IconName, MetadataList, Modal, PageHeader, Stack } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import MuiLink from "@mui/material/Link";
import TextField from "@mui/material/TextField";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import MemoryOutlined from "@mui/icons-material/MemoryOutlined";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import DataResult from "../components/DataResult.component";
import { DeletePortalDialog } from "../components/DeletePortalDialog.component";
import { FormAlert } from "../components/FormAlert.component";
import { PortalSession } from "../components/PortalSession.component";
import { ToolPackChip } from "../components/ToolPackChip.component";
import { sdk, queryKeys } from "../api/sdk";
import { toServerError, type ServerError } from "../utils/api.util";
import { focusFirstInvalidField } from "../utils/form-validation.util";
import { useLayout } from "../utils/layout.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";

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

// ── Portal header metadata ──────────────────────────────────────────
//
// Fetches the station (+ connector instance details) attached to this
// portal and renders a compact metadata row under the page title showing
// the station, its connectors, and its tool packs.

interface PortalHeaderMetaProps {
  stationId: string;
}

export const PortalHeaderMeta: React.FC<PortalHeaderMetaProps> = ({ stationId }) => {
  const { data } = sdk.stations.get(stationId, { include: "connectorInstance" });
  const { isMobile } = useLayout();
  const [expanded, setExpanded] = useState(false);
  const station = data?.station;
  if (!station) return null;

  const instances = station.instances ?? [];
  const toolPacks = station.toolPacks ?? [];

  const metadata = (
    <MetadataList
      size="small"
      spacing={0.75}
      items={[
        {
          label: "Station",
          value: (
            <MuiLink
              component={Link}
              to={`/stations/${station.id}`}
              variant="body2"
              data-testid="portal-header-station-link"
            >
              {station.name}
            </MuiLink>
          ),
        },
        {
          label: "Connectors",
          value: (
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75 }}>
              {instances.map((inst) => (
                <Chip
                  key={inst.id}
                  icon={<MemoryOutlined fontSize="small" />}
                  label={inst.connectorInstance?.name ?? inst.connectorInstanceId}
                  size="small"
                  variant="outlined"
                  color="primary"
                />
              ))}
            </Stack>
          ),
          variant: "chip",
          hidden: instances.length === 0,
        },
        {
          label: "Tool Packs",
          value: (
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75 }}>
              {toolPacks.map((pack) => (
                <ToolPackChip key={pack} pack={pack} />
              ))}
            </Stack>
          ),
          variant: "chip",
          hidden: toolPacks.length === 0,
        },
      ]}
    />
  );

  if (!isMobile) return metadata;

  // On small screens, tuck the metadata behind a toggle so the session feed
  // gets the full viewport. The button is kept small and inline.
  return (
    <Box>
      <Button
        size="small"
        variant="text"
        onClick={() => setExpanded((e) => !e)}
        startIcon={
          <Icon name={expanded ? IconName.ExpandLess : IconName.ExpandMore} />
        }
        aria-expanded={expanded}
        aria-controls="portal-header-meta-panel"
        data-testid="portal-header-meta-toggle"
        sx={{ px: 0.5, textTransform: "none" }}
      >
        {expanded ? "Hide session details" : "Show session details"}
      </Button>
      <Collapse in={expanded} unmountOnExit>
        <Box id="portal-header-meta-panel" sx={{ pt: 1 }}>
          {metadata}
        </Box>
      </Collapse>
    </Box>
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
        queryClient.invalidateQueries({ queryKey: queryKeys.portalResults.root });
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
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<EditIcon />}
                        onClick={() => setRenameOpen(true)}
                      >
                        Rename
                      </Button>
                    }
                    secondaryActions={[
                      { label: "Delete", icon: <DeleteIcon />, onClick: () => setDeleteOpen(true), color: "error" },
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
