/**
 * Step-2 sub-form for adding or editing a single endpoint. Lives in a
 * modal opened from `EndpointsStep`. Phase 1 surfaces path / method /
 * recordsPath / idField; phase 3 widens it with pagination + body.
 */

import React, { useState, useEffect } from "react";

import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { Button, Modal, Stack, Typography } from "@portalai/core/ui";

import { useDialogAutoFocus } from "../../utils/use-dialog-autofocus.util";
import type { FormErrors } from "../../utils/form-validation.util";
import {
  EMPTY_PAGINATION_DRAFT,
  validateEndpoint,
  type PaginationDraft,
} from "./utils/rest-api-validation.util";
import { PaginationFieldsUI } from "./PaginationFields.component";
import { BodyTemplateFieldUI } from "./BodyTemplateField.component";
import { TransformEditorUI } from "./TransformEditor.component";

// ── Draft shape ──────────────────────────────────────────────────────

export interface EndpointDraft {
  key: string;
  label: string;
  path: string;
  method: "GET" | "POST";
  recordsPath: string;
  /** JSONata transform expression (slice 8 wires the editor; slice 7
   *  already invalidates the probe hash on changes). Mutually exclusive
   *  with `recordsPath` — see ApiEndpointConfigSchema's refinement. */
  transform?: string;
  idField: string;
  bodyTemplate: string;
  pagination: PaginationDraft;
}

export const EMPTY_DRAFT: EndpointDraft = {
  key: "",
  label: "",
  path: "",
  method: "GET",
  recordsPath: "",
  idField: "",
  bodyTemplate: "",
  pagination: EMPTY_PAGINATION_DRAFT,
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
  /** Last raw HTTP probe response for the live transform preview
   *  (slice 8). Optional — when null the preview shows a hint. */
  lastProbeResponse?: unknown | null;
  /** Last server-side transform-failed details so the editor can
   *  surface "your last expression errored at the server" inline. */
  lastTransformError?: { kind: "parse" | "runtime"; message: string } | null;
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
  lastProbeResponse,
  lastTransformError,
}) => {
  const keyRef = useDialogAutoFocus(open);

  const field = <K extends keyof EndpointDraft>(
    name: K,
    label: string,
    placeholder?: string
  ) => (
    <TextField
      {...(name === "key" ? { inputRef: keyRef } : {})}
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
      <Stack spacing={2} sx={{ pt: 1 }}>
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

        <Accordion
          defaultExpanded={!!draft.transform && draft.transform.length > 0}
          disableGutters
          square
          sx={{ boxShadow: "none", border: 1, borderColor: "divider" }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon fontSize="small" />}
            aria-controls="transform-editor-panel"
            id="transform-editor-header"
          >
            <Typography variant="body2">
              Advanced — transform (use JSONata for complex shapes)
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <TransformEditorUI
              value={draft.transform ?? ""}
              onChange={(value) => onChange("transform", value)}
              lastProbeResponse={lastProbeResponse ?? null}
              serverError={lastTransformError ?? null}
            />
          </AccordionDetails>
        </Accordion>

        {field(
          "idField",
          "ID field",
          "e.g. id — leave empty for full replacement on each sync"
        )}

        <PaginationFieldsUI
          draft={draft.pagination}
          onChange={(field_, value) =>
            onChange("pagination", {
              ...draft.pagination,
              [field_]: value,
            })
          }
          onBlur={(field_) => onBlur(field_ as keyof EndpointDraft)}
          errors={errors}
          touched={touched}
        />

        {draft.method === "POST" ? (
          <BodyTemplateFieldUI
            value={draft.bodyTemplate}
            onChange={(value) => onChange("bodyTemplate", value)}
            onBlur={() => onBlur("bodyTemplate")}
            error={errors.bodyTemplate}
            touched={touched.bodyTemplate}
          />
        ) : null}
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
    setDraft((d) => {
      const next = { ...d, [field]: value } as EndpointDraft;
      // Clear `bodyTemplate` when the method flips away from POST.
      // GET requests have no body; carrying a stale template would
      // fail backend validation on save.
      if (field === "method" && value !== "POST") {
        next.bodyTemplate = "";
      }
      return next;
    });
    if (touched[field as string]) {
      const draftForValidation =
        field === "method" && value !== "POST"
          ? { ...draft, [field]: value, bodyTemplate: "" }
          : { ...draft, [field]: value };
      setErrors(validateEndpoint(draftForValidation));
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
      bodyTemplate: true,
      // Mark each pagination sub-field touched so its errors surface
      // (the strategy dropdown change doesn't auto-touch each input).
      strategy: true,
      param: true,
      pageSize: true,
      cursorParam: true,
      cursorResponsePath: true,
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
