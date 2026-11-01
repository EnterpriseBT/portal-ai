import React, { useState } from "react";

import { OrganizationUpdateRequestSchema } from "@portalai/core/contracts";
import { Button, Modal, Stack } from "@portalai/core/ui";
import TextField from "@mui/material/TextField";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import {
  focusFirstInvalidField,
  validateWithSchema,
  type FormErrors,
} from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import { blurUnlessDialogControl } from "../utils/dialog-blur.util";

export interface RenameOrganizationDialogUIProps {
  open: boolean;
  onClose: () => void;
  currentName: string;
  onSubmit: (name: string) => void;
  isPending: boolean;
  serverError?: ServerError | null;
}

/** #907: rename the caller's organization (Settings → Organization). */
export const RenameOrganizationDialogUI: React.FC<
  RenameOrganizationDialogUIProps
> = ({ open, onClose, currentName, onSubmit, isPending, serverError }) => {
  const [name, setName] = useState(currentName);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState(false);
  const nameRef = useDialogAutoFocus(open);

  // #801: an unchanged name isn't sent (Save just closes), so one saved before
  // the length limit doesn't block the dialog; only an edited name is checked.
  // Both sides are trimmed: a stored name with stray spaces, saved unedited,
  // isn't a rename.
  const unchanged = currentName.trim();
  const validate = (value: string) =>
    value.trim() === unchanged
      ? ({ success: true, data: { name: unchanged } } as const)
      : validateWithSchema(OrganizationUpdateRequestSchema, { name: value });

  const handleSubmit = () => {
    setTouched(true);
    const result = validate(name);
    if (!result.success) {
      setErrors(result.errors);
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }
    // `name` is optional in the PATCH contract, but this dialog always sends
    // one; never fall back to a blank rename.
    const trimmed = result.data.name;
    if (trimmed === undefined) return;
    setErrors({});
    // The schema trims, so a whitespace-only edit reads as unchanged.
    if (trimmed === unchanged) {
      onClose();
      return;
    }
    onSubmit(trimmed);
  };

  const handleChange = (value: string) => {
    setName(value);
    if (touched) {
      const result = validate(value);
      setErrors(result.success ? {} : result.errors);
    }
  };

  const handleBlur = () => {
    setTouched(true);
    const result = validate(name);
    setErrors(result.success ? {} : result.errors);
  };

  return (
    <Modal
      pending={isPending}
      submitDisabled={isPending}
      open={open}
      onClose={onClose}
      title="Rename organization"
      maxWidth="sm"
      fullWidth
      onSubmit={handleSubmit}
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
          label="Organization name"
          value={name}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={blurUnlessDialogControl(handleBlur)}
          error={touched && !!errors.name}
          helperText={touched && errors.name}
          slotProps={{
            htmlInput: { "aria-invalid": touched && !!errors.name },
          }}
          required
          fullWidth
        />
        <FormAlert serverError={serverError ?? null} />
      </Stack>
    </Modal>
  );
};
