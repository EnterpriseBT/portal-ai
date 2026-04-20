import React from "react";

import Alert from "@mui/material/Alert";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import type { EntityGroupImpactResponsePayload } from "@portalai/core/contracts";
import {
  Button,
  CircularProgress,
  Modal,
  Stack,
  Typography,
} from "@portalai/core/ui";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";

export interface DeleteEntityGroupDialogProps {
  open: boolean;
  onClose: () => void;
  entityGroupName: string;
  onConfirm: () => void;
  isPending?: boolean;
  impact?: EntityGroupImpactResponsePayload | null;
  isLoadingImpact?: boolean;
  serverError?: ServerError | null;
}

const ImpactSummary: React.FC<{
  impact?: EntityGroupImpactResponsePayload | null;
  isLoading?: boolean;
}> = ({ impact, isLoading }) => {
  if (isLoading) {
    return (
      <Stack direction="row" alignItems="center" spacing={1}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">
          Checking associated data...
        </Typography>
      </Stack>
    );
  }

  if (!impact) return null;

  if (impact.entityGroupMembers === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No associated data found.
      </Typography>
    );
  }

  return (
    <List dense disablePadding>
      <ListItem disableGutters sx={{ py: 0 }}>
        <ListItemText
          primary={`${impact.entityGroupMembers} group members`}
          slotProps={{ primary: { variant: "body2" } }}
        />
      </ListItem>
    </List>
  );
};

export const DeleteEntityGroupDialog: React.FC<
  DeleteEntityGroupDialogProps
> = ({
  open,
  onClose,
  entityGroupName,
  onConfirm,
  isPending,
  impact,
  isLoadingImpact,
  serverError,
}) => {
  const deleteDisabled = isPending || isLoadingImpact;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Delete Entity Group"
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          component: "form",
          onSubmit: (e: React.FormEvent) => {
            e.preventDefault();
            if (!deleteDisabled) onConfirm();
          },
        } as object,
      }}
      actions={
        <Stack direction="row" spacing={1}>
          <Button
            type="button"
            variant="outlined"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="contained"
            color="error"
            onClick={() => {
              if (!deleteDisabled) onConfirm();
            }}
            disabled={deleteDisabled}
          >
            {isPending ? "Deleting..." : "Delete"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body1">
          Are you sure you want to delete <strong>{entityGroupName}</strong>?
        </Typography>

        <ImpactSummary impact={impact} isLoading={isLoadingImpact} />

        <Alert severity="warning">
          This action will permanently delete this entity group and all its
          members. This cannot be undone.
        </Alert>
        <FormAlert serverError={serverError ?? null} />
      </Stack>
    </Modal>
  );
};
