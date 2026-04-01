import React, { useState } from "react";

import type {
  EntityRecordPatchRequestBody,
  ColumnDefinitionSummary,
} from "@portalai/core/contracts";
import TextField from "@mui/material/TextField";
import { Button, Modal, Stack, Typography } from "@portalai/core/ui";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";

export interface EditEntityRecordDialogProps {
  open: boolean;
  onClose: () => void;
  columns: ColumnDefinitionSummary[];
  normalizedData: Record<string, unknown>;
  onSubmit: (body: EntityRecordPatchRequestBody) => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}

const EditForm: React.FC<{
  columns: ColumnDefinitionSummary[];
  normalizedData: Record<string, unknown>;
  onSubmit: (body: EntityRecordPatchRequestBody) => void;
  onClose: () => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}> = ({ columns, normalizedData, onSubmit, onClose, isPending, serverError }) => {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const col of columns) {
      const raw = normalizedData[col.key];
      init[col.key] = raw == null ? "" : String(raw);
    }
    return init;
  });
  const firstRef = useDialogAutoFocus(true);

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = () => {
    const updated: Record<string, unknown> = {};
    let hasChanges = false;
    for (const col of columns) {
      const newVal = values[col.key] ?? "";
      const oldVal = normalizedData[col.key] == null ? "" : String(normalizedData[col.key]);
      if (newVal !== oldVal) {
        hasChanges = true;
      }
      updated[col.key] = newVal === "" ? null : newVal;
    }
    if (!hasChanges) {
      onClose();
      return;
    }
    onSubmit({ normalizedData: updated });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit Record"
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          component: "form",
          onSubmit: (e: React.FormEvent) => {
            e.preventDefault();
            handleSubmit();
          },
        } as object,
      }}
      actions={
        <Stack direction="row" spacing={1}>
          <Button type="button" variant="outlined" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" variant="contained" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Edit the normalized field values for this record.
        </Typography>
        {columns.map((col, i) => (
          <TextField
            key={col.key}
            inputRef={i === 0 ? firstRef : undefined}
            label={col.label}
            value={values[col.key] ?? ""}
            onChange={(e) => handleChange(col.key, e.target.value)}
            fullWidth
            size="small"
            multiline={col.type === "json" || col.type === "array"}
            rows={col.type === "json" || col.type === "array" ? 3 : undefined}
          />
        ))}
        <FormAlert serverError={serverError ?? null} />
      </Stack>
    </Modal>
  );
};

export const EditEntityRecordDialog: React.FC<EditEntityRecordDialogProps> = ({
  open,
  onClose,
  columns,
  normalizedData,
  onSubmit,
  isPending,
  serverError,
}) => {
  if (!open) return null;

  return (
    <EditForm
      key={JSON.stringify(normalizedData)}
      columns={columns}
      normalizedData={normalizedData}
      onSubmit={onSubmit}
      onClose={onClose}
      isPending={isPending}
      serverError={serverError}
    />
  );
};
