/**
 * Step-2 sub-form for adding or editing a single endpoint. Lives in a
 * modal opened from `EndpointsStep`. Phase 1 surfaces path / method /
 * recordsPath / idField; phase 3 widens it with pagination + body.
 */

import React, { useState, useEffect } from "react";

import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { Button, Modal, Stack } from "@portalai/core/ui";

import { useDialogAutoFocus } from "../../utils/use-dialog-autofocus.util";
import type { FormErrors } from "../../utils/form-validation.util";
import { validateEndpoint } from "./utils/rest-api-validation.util";

// ── Draft shape ──────────────────────────────────────────────────────

export interface EndpointDraft {
  key: string;
  label: string;
  path: string;
  method: "GET" | "POST";
  recordsPath: string;
  idField: string;
}

export const EMPTY_DRAFT: EndpointDraft = {
  key: "",
  label: "",
  path: "",
  method: "GET",
  recordsPath: "",
  idField: "",
};

// ── Pure UI ──────────────────────────────────────────────────────────

export interface ApiEndpointFormUIProps {
  open: boolean;
  draft: EndpointDraft;
  onChange: <K extends keyof EndpointDraft>(
    field: K,
    value: EndpointDraft[K]
  ) => void;
  onBlur: (field: keyof EndpointDraft) => void;
  onSubmit: () => void;
  onClose: () => void;
  errors: FormErrors;
  touched: Record<string, boolean>;
  isEditing: boolean;
}

export const ApiEndpointFormUI: React.FC<ApiEndpointFormUIProps> = ({
  open,
  draft,
  onChange,
  onBlur,
  onSubmit,
  onClose,
  errors,
  touched,
  isEditing,
}) => {
  const keyRef = useDialogAutoFocus(open);

  const field = <K extends keyof EndpointDraft>(
    name: K,
    label: string,
    placeholder?: string
  ) => (
    <TextField
      label={label}
      value={draft[name]}
      placeholder={placeholder}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
        onChange(name, e.target.value as EndpointDraft[K])
      }
      onBlur={() => onBlur(name)}
      fullWidth
      error={touched[name as string] && !!errors[name as string]}
      helperText={touched[name as string] && errors[name as string]}
      slotProps={{
        htmlInput: {
          "aria-invalid":
            touched[name as string] && !!errors[name as string],
        },
        ...(name === "key" ? { inputRef: keyRef } : {}),
      }}
    />
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit endpoint" : "Add endpoint"}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          component: "form",
          onSubmit: (e: React.FormEvent) => {
            e.preventDefault();
            onSubmit();
          },
        } as object,
      }}
      actions={
        <Stack direction="row" spacing={1}>
          <Button type="button" variant="outlined" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="contained" onClick={onSubmit}>
            {isEditing ? "Save" : "Add"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2}>
        {field("key", "Entity key", "users")}
        {field("label", "Entity label", "Users")}
        {field("path", "Path", "/users")}
        <TextField
          select
          label="Method"
          value={draft.method}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChange("method", e.target.value as EndpointDraft["method"])
          }
          fullWidth
        >
          <MenuItem value="GET">GET</MenuItem>
          <MenuItem value="POST">POST</MenuItem>
        </TextField>
        {field(
          "recordsPath",
          "Records path",
          'e.g. "data.items" — leave empty if the response IS the array'
        )}
        {field(
          "idField",
          "ID field",
          "e.g. id — leave empty for full replacement on each sync"
        )}
      </Stack>
    </Modal>
  );
};

// ── Container ────────────────────────────────────────────────────────

export interface ApiEndpointFormProps {
  open: boolean;
  initial?: EndpointDraft;
  onSubmit: (draft: EndpointDraft) => void;
  onClose: () => void;
}

export const ApiEndpointForm: React.FC<ApiEndpointFormProps> = ({
  open,
  initial,
  onSubmit,
  onClose,
}) => {
  const isEditing = !!initial;
  const [draft, setDraft] = useState<EndpointDraft>(initial ?? EMPTY_DRAFT);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Reset draft each time the modal opens.
  useEffect(() => {
    if (open) {
      setDraft(initial ?? EMPTY_DRAFT);
      setErrors({});
      setTouched({});
    }
  }, [open, initial]);

  const onChange = <K extends keyof EndpointDraft>(
    field: K,
    value: EndpointDraft[K]
  ) => {
    setDraft((d) => ({ ...d, [field]: value }));
    if (touched[field as string]) {
      setErrors(validateEndpoint({ ...draft, [field]: value }));
    }
  };

  const onBlur = (field: keyof EndpointDraft) => {
    setTouched((t) => ({ ...t, [field]: true }));
    setErrors(validateEndpoint(draft));
  };

  const onSubmitInternal = () => {
    const validation = validateEndpoint(draft);
    setErrors(validation);
    setTouched({
      key: true,
      label: true,
      path: true,
      method: true,
      recordsPath: true,
      idField: true,
    });
    if (Object.keys(validation).length === 0) {
      onSubmit(draft);
    }
  };

  return (
    <ApiEndpointFormUI
      open={open}
      draft={draft}
      onChange={onChange}
      onBlur={onBlur}
      onSubmit={onSubmitInternal}
      onClose={onClose}
      errors={errors}
      touched={touched}
      isEditing={isEditing}
    />
  );
};
