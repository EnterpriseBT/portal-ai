import React, { useState } from "react";

import type {
  EntityRecordPatchRequestBody,
  ResolvedColumn,
} from "@portalai/core/contracts";
import { Button, Modal, Stack, Typography } from "@portalai/core/ui";

import { DynamicRecordField } from "./DynamicRecordField.component";
import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import { focusFirstInvalidField } from "../utils/form-validation.util";
import {
  serializeRecordFields,
  validateRequiredFields,
  initializeRecordFields,
} from "../utils/record-field-serialization.util";

export interface EditEntityRecordDialogProps {
  open: boolean;
  onClose: () => void;
  columns: ResolvedColumn[];
  normalizedData: Record<string, unknown>;
  onSubmit: (body: EntityRecordPatchRequestBody) => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}

const EditForm: React.FC<{
  columns: ResolvedColumn[];
  normalizedData: Record<string, unknown>;
  onSubmit: (body: EntityRecordPatchRequestBody) => void;
  onClose: () => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}> = ({ columns, normalizedData, onSubmit, onClose, isPending, serverError }) => {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initializeRecordFields(columns, normalizedData)
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const firstRef = useDialogAutoFocus(true);

  const handleChange = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    // Clear error on change
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleBlur = (key: string) => {
    setTouched((prev) => ({ ...prev, [key]: true }));
  };

  const handleSubmit = () => {
    // Mark all fields as touched
    const allTouched: Record<string, boolean> = {};
    for (const col of columns) allTouched[col.normalizedKey] = true;
    setTouched(allTouched);

    // Validate required fields
    const requiredErrors = validateRequiredFields(columns, values);

    // Serialize values
    const { data: serializedData, errors: serializationErrors } =
      serializeRecordFields(columns, values);

    const mergedErrors = { ...requiredErrors, ...serializationErrors };
    if (Object.keys(mergedErrors).length > 0) {
      setErrors(mergedErrors);
      focusFirstInvalidField();
      return;
    }

    // Change detection: compare serialized values against original normalizedData
    let hasChanges = false;
    for (const col of columns) {
      if (
        JSON.stringify(serializedData[col.normalizedKey]) !==
        JSON.stringify(normalizedData[col.normalizedKey])
      ) {
        hasChanges = true;
        break;
      }
    }

    if (!hasChanges) {
      onClose();
      return;
    }

    onSubmit({ normalizedData: serializedData });
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
          <DynamicRecordField
            key={col.normalizedKey}
            column={col}
            value={values[col.normalizedKey]}
            onChange={handleChange}
            onBlur={() => handleBlur(col.normalizedKey)}
            error={errors[col.normalizedKey]}
            touched={touched[col.normalizedKey]}
            inputRef={i === 0 ? firstRef : undefined}
            disabled={isPending}
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
