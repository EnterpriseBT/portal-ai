import React, { useState } from "react";

import { PinResultBodySchema } from "@portalai/core/contracts";
import { Button, Modal, Stack } from "@portalai/core/ui";
import TextField from "@mui/material/TextField";

import { FormAlert } from "./FormAlert.component";
import { validateWithSchema } from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";

import type { ServerError } from "../utils/api.util";
import type { FormErrors } from "../utils/form-validation.util";

/** The dialog owns the name only; the container knows the block being pinned. */
const NameSchema = PinResultBodySchema.pick({ name: true });

export interface PinResultDialogProps {
  open: boolean;
  onClose: () => void;
  /** Receives the validated, trimmed name. */
  onSubmit: (name: string) => void;
  isPending: boolean;
  /** Non-null keeps the dialog open with the failure visible (#285). */
  serverError: ServerError | null;
}

/**
 * Names a portal result before pinning it (#285).
 *
 * Pure UI: it validates the name and emits it. The container assembles the
 * rest of the body (`portalId` / `messageId` / `blockIndex`), owns the
 * mutation, and passes failures back as `serverError` — which is what keeps
 * this dialog open on a failed pin instead of closing as if it had worked.
 */
export const PinResultDialog: React.FC<PinResultDialogProps> = ({
  open,
  onClose,
  onSubmit,
  isPending,
  serverError,
}) => {
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [wasOpen, setWasOpen] = useState(open);
  const nameRef = useDialogAutoFocus(open);

  // Reset on the closed→open transition only — a failed submit must preserve
  // what the user typed so they can retry from the alert. Adjusted during
  // render (React's documented prop-change pattern) rather than in an effect,
  // which would re-render a second time.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName("");
      setErrors({});
    }
  }

  const handleSubmit = () => {
    const trimmed = name.trim();
    const result = validateWithSchema(NameSchema, { name: trimmed });
    if (!result.success) {
      // The schema's rule (`nameField`, #801) carries its own copy: "Name is
      // required" or the length limit.
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(trimmed);
  };

  const nameError = errors.name;

  return (
    <Modal
      pending={isPending}
      submitDisabled={isPending}
      open={open}
      onClose={onClose}
      title="Name this result"
      maxWidth="xs"
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
            {isPending ? "Pinning..." : "Pin"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          inputRef={nameRef}
          fullWidth
          required
          label="Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (errors.name) setErrors({});
          }}
          error={!!nameError}
          helperText={nameError}
          slotProps={{ htmlInput: { "aria-invalid": !!nameError } }}
        />
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};
