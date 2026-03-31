import React from "react";

import Alert from "@mui/material/Alert";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import type { FieldMappingImpactResponsePayload } from "@portalai/core/contracts";
import {
  Button,
  CircularProgress,
  Modal,
  Stack,
  Typography,
} from "@portalai/core/ui";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";

export interface DeleteFieldMappingDialogProps {
  open: boolean;
  onClose: () => void;
  fieldMappingSourceField: string;
  onConfirm: () => void;
  isPending?: boolean;
  impact?: FieldMappingImpactResponsePayload | null;
  isLoadingImpact?: boolean;
  serverError?: ServerError | null;
}

const ImpactSummary: React.FC<{
  impact?: FieldMappingImpactResponsePayload | null;
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
          primary={`${impact.entityGroupMembers} entity group members`}
          slotProps={{ primary: { variant: "body2" } }}
        />
      </ListItem>
    </List>
  );
};

export const DeleteFieldMappingDialog: React.FC<
  DeleteFieldMappingDialogProps
> = ({
  open,
  onClose,
  fieldMappingSourceField,
  onConfirm,
  isPending,
  impact,
  isLoadingImpact,
  serverError,
}) => {
  const deleteDisabled = isPending || isLoadingImpact;
  const hasCascade = impact && impact.entityGroupMembers > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Delete Field Mapping"
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
          <Button type="button" variant="outlined" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="contained"
            color="error"
            onClick={() => { if (!deleteDisabled) onConfirm(); }}
            disabled={deleteDisabled}
          >
            {isPending ? "Deleting..." : "Delete"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body1">
          Are you sure you want to delete the field mapping for{" "}
          <strong>{fieldMappingSourceField}</strong>?
        </Typography>

        <ImpactSummary impact={impact} isLoading={isLoadingImpact} />

        {hasCascade ? (
          <Alert severity="warning">
            Deleting this field mapping will also remove{" "}
            {impact.entityGroupMembers} entity group member
            {impact.entityGroupMembers !== 1 ? "s" : ""} that depend on it. This
            cannot be undone.
          </Alert>
        ) : (
          <Alert severity="warning">
            This action will permanently delete this field mapping. This cannot
            be undone.
          </Alert>
        )}
        <FormAlert serverError={serverError ?? null} />
      </Stack>
    </Modal>
  );
};
