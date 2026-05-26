/**
 * Step-2 sub-form for adding or editing a single endpoint. Lives in a
 * modal opened from `EndpointsStep`. Phase 1 surfaces path / method /
 * recordsPath / idField; phase 3 widens it with pagination + body.
 */

import React, { useState, useEffect } from "react";

import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import MenuItem from "@mui/material/MenuItem";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import TextField from "@mui/material/TextField";
import { Box, Button, Modal, Stack, Typography } from "@portalai/core/ui";

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

/** Which extractor the endpoint uses — mutually exclusive (decision 10). */
export type ExtractionMode = "recordsPath" | "transform";

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
  /** Active extractor (radio choice). The inactive one is not rendered. */
  extractionMode: ExtractionMode;
  /** Switching modes clears the inactive field on the container side. */
  onExtractionModeChange: (next: ExtractionMode) => void;
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
  extractionMode,
  onExtractionModeChange,
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
        <Box
          sx={{
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            p: 1.5,
          }}
        >
          <FormControl component="fieldset">
            <FormLabel
              component="legend"
              sx={{ fontSize: 13, fontWeight: 500, mb: 0.5 }}
            >
              Records source — choose one
            </FormLabel>
            <RadioGroup
              row
              value={extractionMode}
              onChange={(e) =>
                onExtractionModeChange(e.target.value as ExtractionMode)
              }
              aria-label="Records source extraction mode"
            >
              <FormControlLabel
                value="recordsPath"
                control={<Radio size="small" />}
                label={
                  <Typography variant="body2">
                    Records path{" "}
                    <Typography
                      variant="caption"
                      component="span"
                      color="text.secondary"
                    >
                      — dotted path, e.g. <code>data.items</code>
                    </Typography>
                  </Typography>
                }
              />
              <FormControlLabel
                value="transform"
                control={<Radio size="small" />}
                label={
                  <Typography variant="body2">
                    Advanced{" "}
                    <Typography
                      variant="caption"
                      component="span"
                      color="text.secondary"
                    >
                      — JSONata transform for complex shapes
                    </Typography>
                  </Typography>
                }
              />
            </RadioGroup>
          </FormControl>

          <Box sx={{ mt: 1.5 }}>
            {extractionMode === "recordsPath" ? (
              <TextField
                label="Records path"
                value={draft.recordsPath}
                placeholder={
                  'e.g. "data.items" — leave empty if the response IS the array'
                }
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onChange("recordsPath", e.target.value)
                }
                onBlur={() => onBlur("recordsPath")}
                fullWidth
                error={touched.recordsPath && !!errors.recordsPath}
                helperText={touched.recordsPath && errors.recordsPath}
                slotProps={{
                  htmlInput: {
                    "aria-invalid":
                      touched.recordsPath && !!errors.recordsPath,
                  },
                }}
              />
            ) : (
              <TransformEditorUI
                value={draft.transform ?? ""}
                onChange={(value) => onChange("transform", value)}
                lastProbeResponse={lastProbeResponse ?? null}
                serverError={lastTransformError ?? null}
              />
            )}
          </Box>
        </Box>

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

  // Mutual exclusion is enforced via the radio choice (decision 10).
  // Initial mode is derived from the draft: if `transform` carries a
  // value, the form opens in "transform" mode; otherwise "recordsPath".
  // Switching modes clears the field that just lost focus so the
  // mutually-exclusive invariant stays true at all times.
  const deriveMode = (d: EndpointDraft): ExtractionMode =>
    !!d.transform && d.transform.trim().length > 0
      ? "transform"
      : "recordsPath";

  const [extractionMode, setExtractionMode] = useState<ExtractionMode>(
    deriveMode(initial ?? EMPTY_DRAFT)
  );

  // Reset draft each time the modal opens.
  useEffect(() => {
    if (open) {
      const next = initial ?? EMPTY_DRAFT;
      setDraft(next);
      setExtractionMode(deriveMode(next));
      setErrors({});
      setTouched({});
    }
  }, [open, initial]);

  const onExtractionModeChange = (next: ExtractionMode) => {
    setExtractionMode(next);
    setDraft((d) =>
      next === "recordsPath"
        ? { ...d, transform: undefined }
        : { ...d, recordsPath: "" }
    );
  };

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
      extractionMode={extractionMode}
      onExtractionModeChange={onExtractionModeChange}
    />
  );
};
