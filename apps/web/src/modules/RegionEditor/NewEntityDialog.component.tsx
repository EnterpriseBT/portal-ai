import React, { useMemo, useState } from "react";
import { Modal, Button, TextInput, Stack } from "@portalai/core/ui";
import { z } from "zod";

import {
  focusFirstInvalidField,
  validateWithSchema,
  type FormErrors,
} from "../../utils/form-validation.util";
import { useDialogAutoFocus } from "../../utils/use-dialog-autofocus.util";

export interface NewEntityDialogUIProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (key: string, label: string) => void;
  /**
   * Keys already in use across staged + persisted entities. The dialog rejects
   * duplicates so consumers can trust the emitted key is unique.
   */
  existingKeys: string[];
  /** Optional seed for the Label field. */
  initialLabel?: string;
  /**
   * C2 org-wide pre-check. When provided, the dialog awaits this async
   * validator on submit (after the synchronous Zod check passes) and
   * surfaces any collision inline — the key is already owned by another
   * connector in the org — before calling `onSubmit`.
   */
  validateKey?: (
    key: string
  ) => Promise<{ ok: true } | { ok: false; ownedBy?: string }>;
}

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function buildSchema(existingKeys: string[]) {
  const taken = new Set(existingKeys);
  return z.object({
    label: z.string().trim().min(1, "Label is required"),
    key: z
      .string()
      .trim()
      .min(1, "Key is required")
      .regex(
        KEY_PATTERN,
        "Use lowercase letters, digits, and underscores; must start with a letter"
      )
      .refine((k) => !taken.has(k), {
        message: "Key is already used by another entity",
      }),
  });
}

export const NewEntityDialogUI: React.FC<NewEntityDialogUIProps> = ({
  open,
  onClose,
  onSubmit,
  existingKeys,
  initialLabel = "",
  validateKey,
}) => {
  const [label, setLabel] = useState(initialLabel);
  const [key, setKey] = useState(slugify(initialLabel));
  const [keyDirty, setKeyDirty] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const labelRef = useDialogAutoFocus<HTMLInputElement>(open);

  const schema = useMemo(() => buildSchema(existingKeys), [existingKeys]);

  React.useEffect(() => {
    if (open) {
      setLabel(initialLabel);
      setKey(slugify(initialLabel));
      setKeyDirty(false);
      setErrors({});
      setTouched({});
    }
  }, [open, initialLabel]);

  const handleLabelChange = (value: string) => {
    setLabel(value);
    if (!keyDirty) setKey(slugify(value));
  };

  const handleKeyChange = (value: string) => {
    setKeyDirty(true);
    setKey(value);
  };

  const validate = (): boolean => {
    const result = validateWithSchema(schema, { label, key });
    if (result.success) {
      setErrors({});
      return true;
    }
    setErrors(result.errors);
    setTouched({ label: true, key: true });
    setTimeout(() => focusFirstInvalidField(), 0);
    return false;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    const trimmedKey = key.trim();
    const trimmedLabel = label.trim();
    if (validateKey) {
      const result = await validateKey(trimmedKey);
      if (!result.ok) {
        const ownedBy = result.ownedBy ?? "another connector";
        setErrors((prev) => ({
          ...prev,
          key: `Key is already used by ${ownedBy} in this org.`,
        }));
        setTouched((t) => ({ ...t, key: true }));
        setTimeout(() => focusFirstInvalidField(), 0);
        return;
      }
    }
    onSubmit(trimmedKey, trimmedLabel);
    onClose();
  };

  const labelInvalid = touched.label && !!errors.label;
  const keyInvalid = touched.key && !!errors.key;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create new entity"
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          component: "form",
          onSubmit: handleSubmit,
          noValidate: true,
        } as object,
      }}
      actions={
        <>
          <Button type="button" variant="outlined" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="contained">
            Create
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextInput
          inputRef={labelRef}
          label="Label"
          fullWidth
          required
          value={label}
          onChange={(e) => handleLabelChange(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, label: true }))}
          placeholder="e.g. Contact, Deal, Revenue"
          error={labelInvalid}
          helperText={
            labelInvalid ? errors.label : "Human-readable name for this entity."
          }
          slotProps={{ htmlInput: { "aria-invalid": labelInvalid } }}
        />
        <TextInput
          label="Key"
          fullWidth
          required
          value={key}
          onChange={(e) => handleKeyChange(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, key: true }))}
          placeholder="e.g. contact, deal, revenue"
          error={keyInvalid}
          helperText={
            keyInvalid
              ? errors.key
              : "Stable identifier used by code and integrations. Auto-derived from the label; edit to override."
          }
          slotProps={{
            htmlInput: {
              "aria-invalid": keyInvalid,
              spellCheck: false,
              autoCapitalize: "off",
              autoCorrect: "off",
            },
          }}
        />
      </Stack>
    </Modal>
  );
};
