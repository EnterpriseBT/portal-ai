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

  const hasRecords = impact.entityRecords > 0;
  const hasEntityGroupMembers = impact.entityGroupMembers > 0;
  const hasBidirectional = !!impact.counterpart;

  if (!hasRecords && !hasEntityGroupMembers && !hasBidirectional) {
    return (
      <Typography variant="body2" color="text.secondary">
        No associated data found.
      </Typography>
    );
  }

  return (
    <List dense disablePadding>
      {hasRecords && (
        <ListItem disableGutters sx={{ py: 0 }}>
          <ListItemText
            primary={`${impact.entityRecords} entity record${impact.entityRecords !== 1 ? "s" : ""} on this connector entity`}
            slotProps={{ primary: { variant: "body2" } }}
          />
        </ListItem>
      )}
      {hasEntityGroupMembers && (
        <ListItem disableGutters sx={{ py: 0 }}>
          <ListItemText
            primary={`${impact.entityGroupMembers} entity group member${impact.entityGroupMembers !== 1 ? "s" : ""}`}
            slotProps={{ primary: { variant: "body2" } }}
          />
        </ListItem>
      )}
      {hasBidirectional && (
        <ListItem disableGutters sx={{ py: 0 }}>
          <ListItemText
            primary={`Bidirectional link to "${impact.counterpart!.sourceField}" will be cleared`}
            slotProps={{ primary: { variant: "body2" } }}
          />
        </ListItem>
      )}
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
  const hasRecords = impact ? impact.entityRecords > 0 : false;
  const deleteBlocked = hasRecords;
  const deleteDisabled = isPending || isLoadingImpact || deleteBlocked;
  const hasCascade =
    impact && (impact.entityGroupMembers > 0 || !!impact.counterpart);

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
          Are you sure you want to delete the field mapping for{" "}
          <strong>{fieldMappingSourceField}</strong>?
        </Typography>

        <ImpactSummary impact={impact} isLoading={isLoadingImpact} />

        {deleteBlocked ? (
          <Alert severity="error">
            This field mapping cannot be deleted because its connector entity
            has existing records. Delete the entity records first.
          </Alert>
        ) : hasCascade ? (
          <Alert severity="warning">
            Deleting this field mapping will also affect the associated data
            listed above. This cannot be undone.
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
