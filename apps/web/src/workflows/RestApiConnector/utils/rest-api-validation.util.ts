/**
 * Per-step validation for the REST API connector workflow.
 *
 * Backed by `ApiEndpointConfigSchema` from @portalai/core/models +
 * `validateWithSchema` from the shared form-validation util. Step-level
 * checks (name, baseUrl, credentials) live here rather than in a Zod
 * schema since they're workflow-state-only — the API doesn't accept the
 * entire instance shape in one payload.
 */

import { ApiEndpointConfigSchema } from "@portalai/core/models";
import {
  validateWithSchema,
  type FormErrors,
} from "../../../utils/form-validation.util";

import type { ApiKeyPlacement } from "../ApiKeyCredentialsForm.component";

export type AuthMode = "none" | "apiKey" | "bearer" | "basic";

/**
 * Flat credentials draft held by the workflow container. Mirrors
 * `ApiCredentials` minus the discriminator — the auth mode lives next
 * to it. Empty strings are valid drafts; per-mode required-field checks
 * fire when the user advances.
 */
export interface CredentialsDraft {
  // apiKey
  keyName: string;
  placement: ApiKeyPlacement;
  apiKeyValue: string;
  // bearer
  bearerToken: string;
  // basic
  basicUsername: string;
  basicPassword: string;
}

export const EMPTY_CREDENTIALS_DRAFT: CredentialsDraft = {
  keyName: "",
  placement: "header",
  apiKeyValue: "",
  bearerToken: "",
  basicUsername: "",
  basicPassword: "",
};

/**
 * Step 1 — Basics: name + baseUrl + per-mode credentials. Returns
 * field-keyed errors. The dropdown field key is `authMode`; per-mode
 * credential keys mirror the corresponding credentials-form prop names
 * (`keyName`, `placement`, `value`, `token`, `username`, `password`).
 */
export function validateBasics(input: {
  name: string;
  baseUrl: string;
  authMode: AuthMode;
  credentials: CredentialsDraft;
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

  switch (input.authMode) {
    case "none":
      break;
    case "apiKey":
      if (!input.credentials.keyName.trim()) {
        errors.keyName = "Header or query name is required";
      }
      if (!input.credentials.apiKeyValue.trim()) {
        errors.value = "API key value is required";
      }
      break;
    case "bearer":
      if (!input.credentials.bearerToken.trim()) {
        errors.token = "Bearer token is required";
      }
      break;
    case "basic":
      if (!input.credentials.basicUsername.trim()) {
        errors.username = "Username is required";
      }
      if (!input.credentials.basicPassword.trim()) {
        errors.password = "Password is required";
      }
      break;
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
