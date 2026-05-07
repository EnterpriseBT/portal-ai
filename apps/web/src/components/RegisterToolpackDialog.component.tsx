import React, { useState } from "react";

import {
  RegisterToolpackBodySchema,
  type RegisterToolpackBody,
} from "@portalai/core/contracts";
import { Box, Button, Modal, Stack, Typography } from "@portalai/core/ui";
import TextField from "@mui/material/TextField";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import {
  validateWithSchema,
  focusFirstInvalidField,
  type FormErrors,
} from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Parse the auth-headers textarea value into a `Record<string,string>`.
 * One header per line, `KEY: value` format. Empty lines are skipped.
 * Lines without a colon are treated as malformed and reported via
 * the `error` callback to the caller.
 */
export function parseAuthHeaders(
  raw: string
): { ok: true; value: Record<string, string> } | { ok: false; line: number } {
  const out: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    const idx = line.indexOf(":");
    if (idx < 1) {
      return { ok: false, line: i + 1 };
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) {
      return { ok: false, line: i + 1 };
    }
    out[key] = value;
  }
  return { ok: true, value: out };
}

interface FormState {
  name: string;
  description: string;
  schemaUrl: string;
  runtimeUrl: string;
  metadataUrl: string;
  authHeaders: string;
}

const INITIAL_FORM: FormState = {
  name: "",
  description: "",
  schemaUrl: "",
  runtimeUrl: "",
  metadataUrl: "",
  authHeaders: "",
};

function buildBody(form: FormState): {
  body?: RegisterToolpackBody;
  errors: FormErrors;
} {
  const errors: FormErrors = {};

  let parsedHeaders: Record<string, string> | undefined;
  if (form.authHeaders.trim()) {
    const result = parseAuthHeaders(form.authHeaders);
    if (!result.ok) {
      errors.authHeaders = `Malformed header on line ${result.line}. Use "KEY: value".`;
    } else {
      parsedHeaders = result.value;
    }
  }

  const draft = {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    endpoints: {
      schema: form.schemaUrl.trim(),
      runtime: form.runtimeUrl.trim(),
      ...(form.metadataUrl.trim()
        ? { metadata: form.metadataUrl.trim() }
        : {}),
    },
    ...(parsedHeaders ? { authHeaders: parsedHeaders } : {}),
  };

  const validation = validateWithSchema(RegisterToolpackBodySchema, draft);
  if (!validation.success) {
    Object.assign(errors, validation.errors);
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }
  return {
    body: draft as RegisterToolpackBody,
    errors: {},
  };
}

// ── Pure UI ──────────────────────────────────────────────────────────

export interface RegisterToolpackDialogUIProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: RegisterToolpackBody) => void;
  isPending: boolean;
  serverError: ServerError | null;
}

export const RegisterToolpackDialogUI: React.FC<
  RegisterToolpackDialogUIProps
> = ({ open, onClose, onSubmit, isPending, serverError }) => {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const nameRef = useDialogAutoFocus(open);

  React.useEffect(() => {
    if (open) {
      setForm(INITIAL_FORM);
      setErrors({});
      setTouched({});
    }
  }, [open]);

  const handleChange = (field: keyof FormState, value: string) => {
    const next = { ...form, [field]: value };
    setForm(next);
    if (touched[field]) {
      const { errors: nextErrors } = buildBody(next);
      setErrors(nextErrors);
    }
  };

  const handleBlur = (field: keyof FormState) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const { errors: nextErrors } = buildBody(form);
    setErrors(nextErrors);
  };

  const handleSubmit = () => {
    setTouched({
      name: true,
      schemaUrl: true,
      runtimeUrl: true,
      authHeaders: true,
    });
    const { body, errors: nextErrors } = buildBody(form);
    setErrors(nextErrors);
    if (!body) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }
    onSubmit(body);
  };

  // Most validation errors land under nested paths like `endpoints.schema`;
  // surface them on the corresponding flat-field key for ergonomics.
  const fieldError = (key: string, ...alternates: string[]): string | "" => {
    const match = [key, ...alternates].find((k) => errors[k]);
    return match ? errors[match] : "";
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Register toolpack"
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
            {isPending ? "Registering..." : "Register"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <ExpectedShapesAccordion />

        <TextField
          inputRef={nameRef}
          label="Name"
          value={form.name}
          onChange={(e) => handleChange("name", e.target.value)}
          onBlur={() => handleBlur("name")}
          placeholder="customer_intel"
          error={touched.name && !!errors.name}
          helperText={
            (touched.name && fieldError("name")) ||
            "Lowercase letters, digits, underscores; up to 63 chars."
          }
          slotProps={{
            htmlInput: { "aria-invalid": touched.name && !!errors.name },
          }}
          required
          fullWidth
        />
        <TextField
          label="Description"
          value={form.description}
          onChange={(e) => handleChange("description", e.target.value)}
          placeholder="External customer intelligence calls."
          fullWidth
          multiline
          rows={2}
        />
        <TextField
          label="Schema endpoint"
          value={form.schemaUrl}
          onChange={(e) => handleChange("schemaUrl", e.target.value)}
          onBlur={() => handleBlur("schemaUrl")}
          placeholder="https://api.example.com/toolpacks/customer_intel/schema"
          error={touched.schemaUrl && !!fieldError("endpoints.schema")}
          helperText={
            touched.schemaUrl && fieldError("endpoints.schema")
              ? fieldError("endpoints.schema")
              : "GET endpoint that returns the pack's tools schema."
          }
          slotProps={{
            htmlInput: {
              "aria-invalid":
                touched.schemaUrl && !!fieldError("endpoints.schema"),
            },
          }}
          required
          fullWidth
        />
        <TextField
          label="Runtime endpoint"
          value={form.runtimeUrl}
          onChange={(e) => handleChange("runtimeUrl", e.target.value)}
          onBlur={() => handleBlur("runtimeUrl")}
          placeholder="https://api.example.com/toolpacks/customer_intel/run"
          error={touched.runtimeUrl && !!fieldError("endpoints.runtime")}
          helperText={
            touched.runtimeUrl && fieldError("endpoints.runtime")
              ? fieldError("endpoints.runtime")
              : "POST endpoint invoked per tool call with `{tool, input}`."
          }
          slotProps={{
            htmlInput: {
              "aria-invalid":
                touched.runtimeUrl && !!fieldError("endpoints.runtime"),
            },
          }}
          required
          fullWidth
        />
        <TextField
          label="Metadata endpoint (optional)"
          value={form.metadataUrl}
          onChange={(e) => handleChange("metadataUrl", e.target.value)}
          placeholder="https://api.example.com/toolpacks/customer_intel/metadata"
          fullWidth
        />
        <TextField
          label="Auth headers (optional)"
          value={form.authHeaders}
          onChange={(e) => handleChange("authHeaders", e.target.value)}
          onBlur={() => handleBlur("authHeaders")}
          placeholder={"X-Api-Key: secret123\nAuthorization: Bearer …"}
          error={touched.authHeaders && !!errors.authHeaders}
          helperText={
            (touched.authHeaders && errors.authHeaders) ||
            "One header per line in `KEY: value` format. Stored redacted."
          }
          fullWidth
          multiline
          rows={3}
        />
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};

// ── Expected response shapes (collapsible reference block) ─────────

const SCHEMA_RESPONSE_EXAMPLE = `{
  "tools": [
    {
      "name": "lookup_company",
      "description": "Look up a company by domain.",
      "parameterSchema": {
        "type": "object",
        "properties": {
          "domain": { "type": "string" }
        },
        "required": ["domain"]
      }
    }
  ]
}`;

const RUNTIME_REQUEST_EXAMPLE = `{
  "tool": "lookup_company",
  "input": { "domain": "acme.com" }
}`;

const RUNTIME_RESPONSE_EXAMPLE = `{
  "name": "Acme Inc.",
  "industry": "Manufacturing",
  "founded": 1923
}`;

const METADATA_RESPONSE_EXAMPLE = `{
  "summary": "External customer intelligence calls.",
  "tools": [
    {
      "name": "lookup_company",
      "description": "Looks up a company by its primary domain.",
      "examples": [
        {
          "title": "Lookup by domain",
          "input": { "domain": "acme.com" },
          "output": { "name": "Acme Inc." }
        }
      ]
    }
  ]
}`;

const ExpectedShapesAccordion: React.FC = () => (
  <Accordion variant="outlined" disableGutters>
    <AccordionSummary
      expandIcon={<ExpandMoreIcon />}
      data-testid="register-toolpack-shapes-summary"
    >
      <Typography variant="body2">
        See expected request / response shapes
      </Typography>
    </AccordionSummary>
    <AccordionDetails>
      <Stack spacing={2}>
        <ShapeBlock
          label="GET schema endpoint → response"
          example={SCHEMA_RESPONSE_EXAMPLE}
        />
        <ShapeBlock
          label="POST runtime endpoint → request body"
          example={RUNTIME_REQUEST_EXAMPLE}
        />
        <ShapeBlock
          label="POST runtime endpoint → response (any JSON)"
          example={RUNTIME_RESPONSE_EXAMPLE}
        />
        <ShapeBlock
          label="GET metadata endpoint → response (optional)"
          example={METADATA_RESPONSE_EXAMPLE}
        />
      </Stack>
    </AccordionDetails>
  </Accordion>
);

const ShapeBlock: React.FC<{ label: string; example: string }> = ({
  label,
  example,
}) => (
  <Box>
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
    <Box
      component="pre"
      sx={{
        fontSize: 12,
        backgroundColor: (theme) => theme.palette.action.hover,
        borderRadius: 0.5,
        p: 1.5,
        m: 0,
        mt: 0.5,
        overflow: "auto",
      }}
    >
      {example}
    </Box>
  </Box>
);
