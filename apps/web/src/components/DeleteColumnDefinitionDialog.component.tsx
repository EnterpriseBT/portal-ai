import React from "react";

import Alert from "@mui/material/Alert";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import type { ColumnDefinitionImpactResponsePayload } from "@portalai/core/contracts";
import {
  Button,
  CircularProgress,
  Modal,
  Stack,
  Typography,
} from "@portalai/core/ui";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";

export interface DeleteColumnDefinitionDialogProps {
  open: boolean;
  onClose: () => void;
  columnDefinitionLabel: string;
  onConfirm: () => void;
  isPending?: boolean;
  impact?: ColumnDefinitionImpactResponsePayload | null;
  isLoadingImpact?: boolean;
  serverError?: ServerError | null;
}

const IMPACT_LABELS: {
  key: keyof ColumnDefinitionImpactResponsePayload;
  label: string;
}[] = [
  { key: "fieldMappings", label: "field mappings" },
  { key: "refFieldMappings", label: "reference field mappings" },
  { key: "entityRecords", label: "entity records" },
];

const ImpactSummary: React.FC<{
  impact?: ColumnDefinitionImpactResponsePayload | null;
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

  const nonZeroItems = IMPACT_LABELS.filter(({ key }) => impact[key] > 0);

  if (nonZeroItems.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No associated data found.
      </Typography>
    );
  }

  return (
    <List dense disablePadding>
      {nonZeroItems.map(({ key, label }) => (
        <ListItem key={key} disableGutters sx={{ py: 0 }}>
          <ListItemText
            primary={`${impact[key]} ${label}`}
            slotProps={{ primary: { variant: "body2" } }}
          />
        </ListItem>
      ))}
    </List>
  );
};

export const DeleteColumnDefinitionDialog: React.FC<
  DeleteColumnDefinitionDialogProps
> = ({
  open,
  onClose,
  columnDefinitionLabel,
  onConfirm,
  isPending,
  impact,
  isLoadingImpact,
  serverError,
}) => {
  const hasBlockingDeps =
    impact && (impact.fieldMappings > 0 || impact.refFieldMappings > 0);
  const deleteDisabled = isPending || isLoadingImpact || !!hasBlockingDeps;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Delete Column Definition"
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
          Are you sure you want to delete{" "}
          <strong>{columnDefinitionLabel}</strong>?
        </Typography>

        <ImpactSummary impact={impact} isLoading={isLoadingImpact} />

        {hasBlockingDeps ? (
          <Alert severity="error">
            This column definition cannot be deleted because it is referenced by
            field mappings. Remove or reassign the dependent field mappings
            before deleting.
          </Alert>
        ) : (
          <Alert severity="warning">
            This action will permanently delete this column definition. This
            cannot be undone.
          </Alert>
        )}
        <FormAlert serverError={serverError ?? null} />
      </Stack>
    </Modal>
  );
};
