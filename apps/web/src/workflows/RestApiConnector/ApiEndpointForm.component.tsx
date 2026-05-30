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
import { TransformSuggesterUI } from "./TransformSuggester.component";
import { PreviewPaneUI } from "./PreviewPane.component";

import type { ServerError } from "../../utils/api.util";

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

  /** Preview pane state (raw response + loading + error + truncation). */
  previewResponse: unknown | null;
  previewTruncated: boolean;
  previewLoading: boolean;
  previewError: string | null;
  /** Fires the preview SDK call against the current draft. The
   *  container owns the call so it has access to baseUrl + auth +
   *  credentials without prop-drilling them through the form. */
  onPreview: () => void;

  /** Current value of the AI-suggest prompt-hint textarea. */
  promptHint: string;
  onPromptHintChange: (value: string) => void;
  /** Fires the suggest-transform SDK call. Container-owned for the
   *  same reason as `onPreview`. */
  onSuggest: () => void;
  isSuggesting: boolean;
  /** ServerError from the suggest mutation; renders a FormAlert when set. */
  suggestServerError: ServerError | null;
  /** Validation warning from the route — populated when both Haiku
   *  attempts produced an expression that failed the strict
   *  array-of-objects check. Surfaced via `TransformEditorUI`'s
   *  existing serverError-style Alert. */
  suggestionWarning:
    | { kind: "validation-failed"; message: string }
    | null;
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
  previewResponse,
  previewTruncated,
  previewLoading,
  previewError,
  onPreview,
  promptHint,
  onPromptHintChange,
  onSuggest,
  isSuggesting,
  suggestServerError,
  suggestionWarning,
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
      // `md` (900 px) — wide enough for the side-by-side Preview panes
      // to show meaningful JSON without horizontal scroll. Modal stays
      // fullWidth so smaller viewports still get the full breakpoint.
      maxWidth="md"
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
                serverError={
                  suggestionWarning
                    ? {
                        kind: "runtime",
                        message: suggestionWarning.message,
                      }
                    : lastTransformError ?? null
                }
              />
            )}
          </Box>

          <Box sx={{ mt: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Button
                type="button"
                size="small"
                variant="outlined"
                onClick={onPreview}
                disabled={
                  previewLoading ||
                  !draft.path.trim() ||
                  !draft.method
                }
                aria-label="Preview endpoint response"
              >
                {previewLoading ? "Loading…" : "Preview response"}
              </Button>
              <Typography variant="caption" color="text.secondary">
                Fetches page 1 of the endpoint so you can verify the
                {extractionMode === "recordsPath"
                  ? " records path"
                  : " transform"}
                {" "}
                resolves to the right records before committing.
              </Typography>
            </Stack>
          </Box>

          <Box sx={{ mt: 1.5 }}>
            <PreviewPaneUI
              response={previewResponse}
              truncated={previewTruncated}
              loading={previewLoading}
              error={previewError}
              extractionMode={extractionMode}
              recordsPath={draft.recordsPath}
              transform={draft.transform ?? ""}
            />
          </Box>

          {extractionMode === "transform" ? (
            <Box sx={{ mt: 1.5 }}>
              <TransformSuggesterUI
                promptHint={promptHint}
                onPromptHintChange={onPromptHintChange}
                onSuggest={onSuggest}
                isSuggesting={isSuggesting}
                disabled={previewResponse == null}
                disabledReason="Run Preview first to capture a sample response."
                serverError={suggestServerError}
              />
            </Box>
          ) : null}
        </Box>

        {field(
          "idField",
          "ID field",
          "e.g. id — leave empty for full replacement on each sync"
        )}

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
  /**
   * Async callback that fetches the upstream page-1 response for the
   * current draft. Provided by the workflow container so it can
   * supply baseUrl + auth + credentials without prop-drilling them
   * through the form. Resolves with the preview payload; rejects
   * with the user-facing error message on failure.
   */
  onPreview?: (draft: EndpointDraft) => Promise<{
    body: unknown;
    truncated: boolean;
  }>;
  /**
   * Async callback that asks the API for a JSONata transform
   * suggestion against the current preview response. Provided by the
   * workflow so the form stays SDK-agnostic. Receives the trimmed
   * `promptHint` (`undefined` when blank) and the captured
   * `sampleResponse`. Resolves with the suggested expression + an
   * optional validation warning; rejects with a `ServerError`-shaped
   * exception (`{ message, code }`) so the form can surface it via
   * FormAlert.
   */
  onSuggest?: (input: {
    promptHint: string | undefined;
    sampleResponse: unknown;
  }) => Promise<{
    expression: string;
    warning: { kind: "validation-failed"; message: string } | null;
  }>;
}

export const ApiEndpointForm: React.FC<ApiEndpointFormProps> = ({
  open,
  initial,
  onSubmit,
  onClose,
  onPreview,
  onSuggest,
}) => {
  const isEditing = !!initial;
  const [draft, setDraft] = useState<EndpointDraft>(initial ?? EMPTY_DRAFT);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Preview pane state — owned per modal session so closing + reopening
  // the form starts fresh.
  const [previewResponse, setPreviewResponse] = useState<unknown | null>(null);
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // AI-suggest state — also owned per modal session so reopening the
  // form clears the hint + any prior warning/error.
  const [promptHint, setPromptHint] = useState("");
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestServerError, setSuggestServerError] =
    useState<ServerError | null>(null);
  const [suggestionWarning, setSuggestionWarning] = useState<
    { kind: "validation-failed"; message: string } | null
  >(null);

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
      setPreviewResponse(null);
      setPreviewTruncated(false);
      setPreviewError(null);
      setPreviewLoading(false);
      setPromptHint("");
      setIsSuggesting(false);
      setSuggestServerError(null);
      setSuggestionWarning(null);
    }
  }, [open, initial]);

  const handlePreview = async () => {
    if (!onPreview) {
      setPreviewError("Preview is unavailable in this context.");
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await onPreview(draft);
      setPreviewResponse(result.body);
      setPreviewTruncated(result.truncated);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSuggest = async () => {
    if (!onSuggest) {
      setSuggestServerError({
        message: "Suggest is unavailable in this context.",
        code: "REST_API_OPERATION_FAILED",
      });
      return;
    }
    // Defensive: the UI keeps the button disabled when there's no
    // captured preview response, but the callback path checks anyway.
    if (previewResponse == null) return;

    const trimmed = promptHint.trim();
    setIsSuggesting(true);
    setSuggestServerError(null);
    try {
      const result = await onSuggest({
        promptHint: trimmed.length > 0 ? trimmed : undefined,
        sampleResponse: previewResponse,
      });
      setDraft((d) => ({ ...d, transform: result.expression }));
      setSuggestionWarning(result.warning);
    } catch (err) {
      // The workflow rejects with a ServerError-shaped exception.
      // Anything else degrades to a generic error code.
      const message = err instanceof Error ? err.message : "Suggest failed";
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code ?? "REST_API_OPERATION_FAILED")
          : "REST_API_OPERATION_FAILED";
      setSuggestServerError({ message, code });
    } finally {
      setIsSuggesting(false);
    }
  };

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
    // Any manual edit to the transform field invalidates the warning
    // we surfaced from the last Suggest call — the warning is about
    // the expression, not the current draft value once the user
    // changes it.
    if (field === "transform") {
      setSuggestionWarning(null);
    }
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
      previewResponse={previewResponse}
      previewTruncated={previewTruncated}
      previewLoading={previewLoading}
      previewError={previewError}
      onPreview={() => void handlePreview()}
      promptHint={promptHint}
      onPromptHintChange={setPromptHint}
      onSuggest={() => void handleSuggest()}
      isSuggesting={isSuggesting}
      suggestServerError={suggestServerError}
      suggestionWarning={suggestionWarning}
    />
  );
};
