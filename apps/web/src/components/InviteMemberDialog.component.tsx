import React, { useState } from "react";

import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";

import { Button, Modal, Stack } from "@portalai/core/ui";
import {
  InviteCreateRequestSchema,
  type InviteCreateRequest,
} from "@portalai/core/contracts";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import {
  validateWithSchema,
  focusFirstInvalidField,
  type FormErrors,
} from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";

/** Invitable roles — `owner` is excluded (ownership transfer is out of scope). */
type InvitableRole = InviteCreateRequest["role"];

interface InviteFormState {
  email: string;
  role: InvitableRole;
}

const INITIAL_FORM: InviteFormState = { email: "", role: "member" };

const validateForm = (form: InviteFormState): FormErrors => {
  const result = validateWithSchema(InviteCreateRequestSchema, form);
  return result.success ? {} : result.errors;
};

export interface InviteMemberDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (req: InviteCreateRequest) => void;
  isPending: boolean;
  serverError: ServerError | null;
}

/**
 * Invite-a-member dialog (#585) — Form & Dialog pattern, validated against
 * `InviteCreateRequestSchema` (email + role; `owner` is not invitable). On
 * success the parent surfaces the returned invite link to copy (no email is
 * sent). Stays open on a server error so the message (e.g. seat cap, already a
 * member) is readable.
 */
export const InviteMemberDialog: React.FC<InviteMemberDialogProps> = ({
  open,
  onClose,
  onSubmit,
  isPending,
  serverError,
}) => {
  const [form, setForm] = useState<InviteFormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const emailRef = useDialogAutoFocus(open);

  React.useEffect(() => {
    if (open) {
      setForm(INITIAL_FORM);
      setErrors({});
      setTouched({});
    }
  }, [open]);

  const handleChange = (field: keyof InviteFormState, value: string) => {
    const next = { ...form, [field]: value } as InviteFormState;
    setForm(next);
    if (touched[field]) setErrors(validateForm(next));
  };

  const handleBlur = (field: keyof InviteFormState) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors(validateForm(form));
  };

  const handleSubmit = () => {
    setTouched({ email: true, role: true });
    const formErrors = validateForm(form);
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }
    onSubmit({ email: form.email.trim(), role: form.role });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite a member"
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
            {isPending ? "Inviting..." : "Invite"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <TextField
          inputRef={emailRef}
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => handleChange("email", e.target.value)}
          onBlur={() => handleBlur("email")}
          error={touched.email && !!errors.email}
          helperText={touched.email && errors.email}
          slotProps={{
            htmlInput: { "aria-invalid": touched.email && !!errors.email },
          }}
          required
          fullWidth
        />
        <TextField
          select
          label="Role"
          value={form.role}
          onChange={(e) => handleChange("role", e.target.value)}
          onBlur={() => handleBlur("role")}
          error={touched.role && !!errors.role}
          helperText={touched.role && errors.role}
          slotProps={{
            htmlInput: { "aria-invalid": touched.role && !!errors.role },
          }}
          fullWidth
        >
          <MenuItem value="member">member</MenuItem>
          <MenuItem value="admin">admin</MenuItem>
        </TextField>
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};
