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
import Chip from "@mui/material/Chip";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
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

/**
 * Common auth-header boilerplates surfaced as one-click inserts above
 * the auth-headers textarea so users don't have to remember exact
 * header names like `X-Api-Key` while typing. Shared by the register
 * and edit dialogs.
 */
export const AUTH_HEADER_BOILERPLATES: ReadonlyArray<{
  label: string;
  template: string;
}> = [
    { label: "Bearer token", template: "Authorization: Bearer <token>" },
    { label: "API key", template: "X-Api-Key: <key>" },
    { label: "Basic auth", template: "Authorization: Basic <base64>" },
    { label: "Custom header", template: "X-Custom-Header: <value>" },
  ];

/**
 * Append a boilerplate line to an existing auth-headers textarea
 * value, ensuring exactly one newline between entries and trimming
 * trailing whitespace from the previous content.
 */
export function appendAuthHeaderBoilerplate(
  current: string,
  template: string
): string {
  const trimmed = current.replace(/\s+$/, "");
  if (trimmed.length === 0) return template;
  return `${trimmed}\n${template}`;
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
      title={
        <Stack spacing={0.25} data-testid="register-toolpack-title">
          <span>Register toolpack</span>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ lineHeight: 1.4, fontWeight: 400 }}
          >
            Connect your own webhook server so the assistant can call its
            tools during portal sessions. Portals.ai fetches your tool catalog
            once at registration, then HMAC-signs every outbound call so your
            server can verify the request came from us.
          </Typography>
        </Stack>
      }
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
        <Stack spacing={0.75}>
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
          <Stack
            direction="row"
            spacing={0.75}
            flexWrap="wrap"
            useFlexGap
            data-testid="auth-headers-boilerplates"
          >
            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
              Insert:
            </Typography>
            {AUTH_HEADER_BOILERPLATES.map((bp) => (
              <Chip
                key={bp.label}
                label={bp.label}
                size="small"
                variant="outlined"
                clickable
                onClick={() =>
                  handleChange(
                    "authHeaders",
                    appendAuthHeaderBoilerplate(form.authHeaders, bp.template)
                  )
                }
                data-testid={`auth-headers-boilerplate-${bp.label
                  .toLowerCase()
                  .replace(/\s+/g, "-")}`}
              />
            ))}
          </Stack>
        </Stack>
        <FormAlert serverError={serverError} />

        <Stack
          spacing={0.5}
          sx={{ pt: 1, borderTop: 1, borderColor: "divider" }}
          data-testid="register-toolpack-reference-section"
        >
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ lineHeight: 1.4 }}
          >
            Reference
          </Typography>
          <TabbedSnippetAccordion
            testId="register-toolpack-endpoint-shapes"
            summary="See expected request / response shapes per endpoint"
            tabs={[
              {
                label: "Schema",
                blocks: [
                  { label: "GET → response", example: SCHEMA_RESPONSE_EXAMPLE },
                ],
              },
              {
                label: "Runtime",
                blocks: [
                  {
                    label: "POST → request body",
                    example: RUNTIME_REQUEST_EXAMPLE,
                  },
                  {
                    label: "POST → response (any JSON)",
                    example: RUNTIME_RESPONSE_EXAMPLE,
                  },
                ],
              },
              {
                label: "Metadata",
                blocks: [
                  { label: "GET → response", example: METADATA_RESPONSE_EXAMPLE },
                ],
              },
            ]}
          />
          <TabbedSnippetAccordion
            testId="register-toolpack-verify-snippets"
            summary="See how to verify our signed requests on your server"
            tabs={[
              { label: "TypeScript", blocks: [{ example: VERIFY_TS_EXAMPLE }] },
              { label: "Python", blocks: [{ example: VERIFY_PYTHON_EXAMPLE }] },
              { label: "C#", blocks: [{ example: VERIFY_CSHARP_EXAMPLE }] },
            ]}
          />
        </Stack>
      </Stack>
    </Modal>
  );
};

// ── Per-field shape examples ───────────────────────────────────────

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

// ── Verification snippets ──────────────────────────────────────────
//
// We sign every outbound call (schema / metadata / runtime) with the
// per-toolpack signing secret. Receivers should verify three headers:
//   X-Portalai-Timestamp   unix seconds (reject if > 300 s old or
//                          > 60 s in the future)
//   X-Portalai-Webhook-Id  uuid (idempotency key)
//   X-Portalai-Signature   "v1=<hex of HMAC-SHA256 over
//                          `<ts>.<id>.<rawBody>` with the secret>"
//
// Each snippet below is a complete, copy-paste-able middleware that
// rejects unsigned / stale / tampered requests with 401 + a stable
// error code. The dialog renders all three side-by-side so the
// reader can pick the language matching their stack.

const VERIFY_TS_EXAMPLE = `import crypto from "crypto";
import express from "express";

const SIGNING_SECRET = process.env.TOOLPACK_SIGNING_SECRET!;
const app = express();

// Capture the raw body BEFORE express.json() consumes it.
app.use(express.json({
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));

app.use((req, res, next) => {
  const ts = req.header("X-Portalai-Timestamp");
  const id = req.header("X-Portalai-Webhook-Id");
  const sig = req.header("X-Portalai-Signature");
  if (!ts || !id || !sig) {
    return res.status(401).json({ error: "SIGNATURE_MISSING" });
  }
  const ageSec = Math.floor(Date.now() / 1000) - Number(ts);
  if (Number.isNaN(ageSec) || ageSec > 300 || ageSec < -60) {
    return res.status(401).json({ error: "TIMESTAMP_STALE" });
  }
  const rawBody = (req as any).rawBody?.toString("utf8") ?? "";
  const expected = crypto
    .createHmac("sha256", SIGNING_SECRET)
    .update(\`\${ts}.\${id}.\${rawBody}\`)
    .digest("hex");
  const provided = sig.startsWith("v1=") ? sig.slice(3) : "";
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "SIGNATURE_INVALID" });
  }
  next();
});

app.post("/runtime", (req, res) => {
  // Your tool dispatcher here.
  res.json({ /* tool output */ });
});`;

const VERIFY_PYTHON_EXAMPLE = `import hmac, hashlib, os, time
from flask import Flask, request, abort, jsonify

SIGNING_SECRET = os.environ["TOOLPACK_SIGNING_SECRET"].encode()
app = Flask(__name__)

@app.before_request
def verify_signature():
    ts  = request.headers.get("X-Portalai-Timestamp")
    wid = request.headers.get("X-Portalai-Webhook-Id")
    sig = request.headers.get("X-Portalai-Signature", "")
    if not (ts and wid and sig):
        abort(401, "SIGNATURE_MISSING")

    age = int(time.time()) - int(ts)
    if age > 300 or age < -60:
        abort(401, "TIMESTAMP_STALE")

    raw = request.get_data()  # raw bytes, BEFORE JSON parsing
    payload = f"{ts}.{wid}.".encode() + raw
    expected = hmac.new(SIGNING_SECRET, payload, hashlib.sha256).hexdigest()
    provided = sig[3:] if sig.startswith("v1=") else ""
    if not hmac.compare_digest(expected, provided):
        abort(401, "SIGNATURE_INVALID")

@app.post("/runtime")
def runtime():
    body = request.get_json()
    # Your tool dispatcher here.
    return jsonify({ "result": "..." })`;

const VERIFY_CSHARP_EXAMPLE = `using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;

var SIGNING_SECRET = Environment.GetEnvironmentVariable(
    "TOOLPACK_SIGNING_SECRET")!;

var app = WebApplication.Create();

app.Use(async (ctx, next) =>
{
    var ts  = ctx.Request.Headers["X-Portalai-Timestamp"].ToString();
    var id  = ctx.Request.Headers["X-Portalai-Webhook-Id"].ToString();
    var sig = ctx.Request.Headers["X-Portalai-Signature"].ToString();

    if (string.IsNullOrEmpty(ts) ||
        string.IsNullOrEmpty(id) ||
        string.IsNullOrEmpty(sig) ||
        !long.TryParse(ts, out var tsNum))
    {
        ctx.Response.StatusCode = 401;
        await ctx.Response.WriteAsJsonAsync(new { error = "SIGNATURE_MISSING" });
        return;
    }

    var ageSec = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - tsNum;
    if (ageSec > 300 || ageSec < -60)
    {
        ctx.Response.StatusCode = 401;
        await ctx.Response.WriteAsJsonAsync(new { error = "TIMESTAMP_STALE" });
        return;
    }

    // Buffer so we can read the body twice.
    ctx.Request.EnableBuffering();
    using var reader = new StreamReader(
        ctx.Request.Body, Encoding.UTF8, leaveOpen: true);
    var rawBody = await reader.ReadToEndAsync();
    ctx.Request.Body.Position = 0;

    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(SIGNING_SECRET));
    var expected = Convert
        .ToHexString(hmac.ComputeHash(
            Encoding.UTF8.GetBytes($"{ts}.{id}.{rawBody}")))
        .ToLowerInvariant();
    var provided = sig.StartsWith("v1=") ? sig[3..] : "";

    var a = Convert.FromHexString(expected);
    var b = provided.Length == expected.Length
        ? Convert.FromHexString(provided)
        : Array.Empty<byte>();
    if (!CryptographicOperations.FixedTimeEquals(a, b))
    {
        ctx.Response.StatusCode = 401;
        await ctx.Response.WriteAsJsonAsync(new { error = "SIGNATURE_INVALID" });
        return;
    }

    await next(ctx);
});

app.MapPost("/runtime", async (HttpContext ctx) =>
{
    // Your tool dispatcher here.
    await ctx.Response.WriteAsJsonAsync(new { /* tool output */ });
});

app.Run();`;

/**
 * Collapsible accordion that surfaces labeled code-block examples
 * one tab at a time instead of stacking them vertically. Each tab
 * holds one or more labeled code blocks — pass a single block when
 * the tab represents a single snippet (e.g. a verification recipe in
 * one language), pass multiple when the tab represents an endpoint
 * with both request and response shapes. The accordion itself
 * remains collapsible so the dialog stays compact when the snippets
 * aren't being read.
 */
interface SnippetBlock {
  /** Optional sub-heading shown above the code block. */
  label?: string;
  example: string;
}

interface SnippetTab {
  /** Tab label (also used to derive the test-id). */
  label: string;
  blocks: SnippetBlock[];
}

const TabbedSnippetAccordion: React.FC<{
  testId: string;
  summary: string;
  tabs: SnippetTab[];
}> = ({ testId, summary, tabs }) => {
  const [active, setActive] = useState(0);
  const current = tabs[active] ?? tabs[0];
  return (
    <Accordion
      variant="outlined"
      disableGutters
      sx={{
        "&::before": { display: "none" },
        backgroundColor: "transparent",
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon fontSize="small" />}
        data-testid={`${testId}-summary`}
        sx={{ minHeight: 32, "& .MuiAccordionSummary-content": { my: 0.5 } }}
      >
        <Typography variant="caption" color="text.secondary">
          {summary}
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <Stack spacing={1}>
          <Tabs
            value={active}
            onChange={(_e, v: number) => setActive(v)}
            variant="standard"
            sx={{ minHeight: 32, "& .MuiTab-root": { minHeight: 32, py: 0.5 } }}
            data-testid={`${testId}-tabs`}
          >
            {tabs.map((t, i) => (
              <Tab
                key={t.label}
                label={t.label}
                data-testid={`${testId}-tab-${t.label
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")}`}
                value={i}
              />
            ))}
          </Tabs>
          {current && (
            <Stack
              spacing={1}
              data-testid={`${testId}-active-snippet`}
              sx={{ maxHeight: 360, overflow: "auto" }}
            >
              {current.blocks.map((b, i) => (
                <Box key={`${current.label}-${i}`}>
                  {b.label && (
                    <Typography variant="caption" color="text.secondary">
                      {b.label}
                    </Typography>
                  )}
                  <Box
                    component="pre"
                    sx={{
                      fontSize: 12,
                      backgroundColor: (theme) => theme.palette.action.hover,
                      borderRadius: 0.5,
                      p: 1.5,
                      m: 0,
                      mt: b.label ? 0.5 : 0,
                      overflow: "auto",
                    }}
                  >
                    {b.example}
                  </Box>
                </Box>
              ))}
            </Stack>
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
};

