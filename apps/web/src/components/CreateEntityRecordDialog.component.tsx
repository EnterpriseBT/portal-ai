import React, { useState } from "react";

import type {
  EntityRecordCreateRequestBody,
  ResolvedColumn,
} from "@portalai/core/contracts";
import { Button, Modal, Stack } from "@portalai/core/ui";

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

export interface CreateEntityRecordDialogProps {
  open: boolean;
  onClose: () => void;
  columns: ResolvedColumn[];
  onSubmit: (body: EntityRecordCreateRequestBody) => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}

const CreateForm: React.FC<{
  columns: ResolvedColumn[];
  onSubmit: (body: EntityRecordCreateRequestBody) => void;
  onClose: () => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}> = ({ columns, onSubmit, onClose, isPending, serverError }) => {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initializeRecordFields(columns)
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const firstRef = useDialogAutoFocus(true);

  const handleChange = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
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

    onSubmit({ normalizedData: serializedData });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New Record"
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
            {isPending ? "Creating..." : "Create"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
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

export const CreateEntityRecordDialog: React.FC<CreateEntityRecordDialogProps> = ({
  open,
  onClose,
  columns,
  onSubmit,
  isPending,
  serverError,
}) => {
  if (!open) return null;

  return (
    <CreateForm
      key="create-record"
      columns={columns}
      onSubmit={onSubmit}
      onClose={onClose}
      isPending={isPending}
      serverError={serverError}
    />
  );
};
