import React from "react";

import { Button, Modal, Stack } from "@portalai/core/ui";
import Typography from "@mui/material/Typography";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";

export interface DeleteToolpackDialogUIProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  toolpackName: string;
  /**
   * Stations currently enabling this toolpack — they will lose access
   * when the pack is deleted.
   */
  impactedStations?: Array<{ id: string; name?: string }>;
  isPending: boolean;
  serverError: ServerError | null;
}

export const DeleteToolpackDialogUI: React.FC<DeleteToolpackDialogUIProps> = ({
  open,
  onClose,
  onConfirm,
  toolpackName,
  impactedStations = [],
  isPending,
  serverError,
}) => {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Delete toolpack"
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          component: "form",
          onSubmit: (e: React.FormEvent) => {
            e.preventDefault();
            onConfirm();
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
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "Deleting..." : "Delete"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2">
          Soft-delete <strong>{toolpackName}</strong>? Stations that have it
          attached will lose access to its tools immediately.
        </Typography>
        {impactedStations.length > 0 && (
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary">
              Impacted stations ({impactedStations.length})
            </Typography>
            <Stack component="ul" spacing={0} sx={{ pl: 2.5, m: 0 }}>
              {impactedStations.map((s) => (
                <Typography
                  key={s.id}
                  variant="body2"
                  component="li"
                  data-testid="delete-toolpack-impacted-station"
                >
                  {s.name ?? s.id}
                </Typography>
              ))}
            </Stack>
          </Stack>
        )}
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};
