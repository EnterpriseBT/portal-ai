/**
 * Per-step validation for the REST API connector workflow.
 *
 * Backed by `ApiEndpointConfigSchema` from @portalai/core/models +
 * `validateWithSchema` from the shared form-validation util. Step-level
 * checks (name, baseUrl) live here rather than in a Zod schema since
 * they're workflow-state-only — the API doesn't accept the entire
 * instance shape in one payload.
 */

import { ApiEndpointConfigSchema } from "@portalai/core/models";
import {
  validateWithSchema,
  type FormErrors,
} from "../../../utils/form-validation.util";

/** Step 1 — Basics: name + baseUrl. */
export function validateBasics(input: {
  name: string;
  baseUrl: string;
}): FormErrors {
  const errors: FormErrors = {};
  if (!input.name.trim()) errors.name = "Name is required";
  if (!input.baseUrl.trim()) {
    errors.baseUrl = "Base URL is required";
  } else {
    try {
      new URL(input.baseUrl);
    } catch {
      errors.baseUrl = "Must be a valid URL (e.g. https://api.example.com)";
    }
  }
  return errors;
}

/** Step 2 — Endpoint form: validate one endpoint draft via Zod. */
export function validateEndpoint(input: {
  key: string;
  label: string;
  path: string;
  method: string;
  recordsPath: string;
  idField: string;
}): FormErrors {
  const errors: FormErrors = {};
  if (!input.key.trim()) errors.key = "Key is required";
  if (!input.label.trim()) errors.label = "Label is required";

  const result = validateWithSchema(ApiEndpointConfigSchema, {
    path: input.path,
    method: input.method,
    recordsPath: input.recordsPath,
    idField: input.idField || null,
  });
  if (!result.success) {
    return { ...errors, ...result.errors };
  }
  return errors;
}

/** Step 2 — list of endpoints: at least one required to advance. */
export function validateEndpointsList(endpoints: unknown[]): FormErrors {
  if (endpoints.length === 0) {
    return { endpoints: "Add at least one endpoint before continuing" };
  }
  return {};
}
