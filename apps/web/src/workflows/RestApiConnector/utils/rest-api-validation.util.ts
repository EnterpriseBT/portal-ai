/**
 * Per-step validation for the REST API connector workflow.
 *
 * Backed by `ApiEndpointConfigSchema` from @portalai/core/models +
 * `validateWithSchema` from the shared form-validation util. Step-level
 * checks (name, baseUrl, credentials) live here rather than in a Zod
 * schema since they're workflow-state-only — the API doesn't accept the
 * entire instance shape in one payload.
 */

import {
  ApiEndpointConfigSchema,
  type PaginationConfig,
} from "@portalai/core/models";
import {
  KEY_MAX_LENGTH,
  NAME_MAX_LENGTH,
  tooLongMessage,
  type ApiColumnSuggestion,
} from "@portalai/core/contracts";
import {
  validateWithSchema,
  type FormErrors,
} from "../../../utils/form-validation.util";
import {
  hasKeyValueRows,
  keyValueRowsToRecord,
  keyValueRowValueErrorKey,
  newKeyValueRow,
  validateKeyValueRows,
  type KeyValueRow,
} from "../../../utils/key-value-rows.util";

import type { ApiKeyPlacement } from "../ApiKeyCredentialsForm.component";

export type AuthMode = "none" | "apiKey" | "bearer" | "basic";

/**
 * Flat pagination draft held by the endpoint form. Mirrors the four
 * `PaginationConfig` arms with every field always present (defaults
 * applied) so the user can flip between strategies without losing
 * pending field values. `paginationDraftToConfig` projects the active
 * strategy back into a structured `PaginationConfig` on commit.
 */
export interface PaginationDraft {
  strategy: "none" | "pageOffset" | "cursor" | "linkHeader" | "linkBody";
  // pageOffset
  style: "page" | "offset";
  param: string;
  pageSize: number;
  pageSizeParam: string;
  startPage: number;
  stopOnShortPage: boolean;
  // cursor
  cursorParam: string;
  cursorPlacement: "query" | "header" | "body";
  cursorResponsePath: string;
  // linkBody
  nextUrlPath: string;
}

export const EMPTY_PAGINATION_DRAFT: PaginationDraft = {
  strategy: "none",
  style: "page",
  param: "page",
  pageSize: 1,
  pageSizeParam: "",
  startPage: 1,
  stopOnShortPage: true,
  cursorParam: "cursor",
  cursorPlacement: "query",
  cursorResponsePath: "",
  nextUrlPath: "",
};

/** Project the flat draft into a structured `PaginationConfig`. */
export function paginationDraftToConfig(d: PaginationDraft): PaginationConfig {
  switch (d.strategy) {
    case "none":
      return { strategy: "none" };
    case "pageOffset":
      // pageOffset is a union over `style`; build the variant
      // explicitly so the inferred type narrows to the right branch.
      // Offset-style requires pageSizeParam; page-style accepts it as
      // optional.
      if (d.style === "offset") {
        return {
          strategy: "pageOffset",
          style: "offset",
          param: d.param,
          pageSize: d.pageSize,
          pageSizeParam: d.pageSizeParam,
          startPage: d.startPage,
          stopOnShortPage: d.stopOnShortPage,
        };
      }
      return {
        strategy: "pageOffset",
        style: "page",
        param: d.param,
        pageSize: d.pageSize,
        ...(d.pageSizeParam.trim() !== ""
          ? { pageSizeParam: d.pageSizeParam }
          : {}),
        startPage: d.startPage,
        stopOnShortPage: d.stopOnShortPage,
      };
    case "cursor":
      return {
        strategy: "cursor",
        cursorParam: d.cursorParam,
        cursorPlacement: d.cursorPlacement,
        cursorResponsePath: d.cursorResponsePath,
      };
    case "linkHeader":
      return { strategy: "linkHeader" };
    case "linkBody":
      return { strategy: "linkBody", nextUrlPath: d.nextUrlPath };
  }
}

/**
 * Project the endpoint form's flat totalCount fields (#458) into the
 * config block, or `undefined` when the section is untouched.
 *
 * `params` are the table's rows (#808); no rows with a set path is valid —
 * some APIs carry the total on the plain response ("meta.totalCount") and
 * need no override.
 * The reverse (params without a path) is a validation error, handled in
 * `validateEndpoint` — there'd be no way to read the count.
 */
export function totalCountDraftToConfig(
  params: KeyValueRow[],
  path: string
): { queryParams: Record<string, string>; responsePath: string } | undefined {
  const trimmedPath = path.trim();
  if (trimmedPath === "") return undefined;
  return {
    queryParams: keyValueRowsToRecord(params),
    responsePath: trimmedPath,
  };
}

/**
 * #808: split a Path that carries a query string into the path and one row
 * per param. `URLSearchParams` decodes the values (`%26` → `&`, `+` → space),
 * so the rows show what the user meant. A `#fragment` is never sent, so it's
 * cut first: a `?` inside it isn't a query string.
 */
export function splitPathQuery(path: string): {
  path: string;
  rows: KeyValueRow[];
} {
  const hash = path.indexOf("#");
  const unfragmented = hash === -1 ? path : path.slice(0, hash);
  const q = unfragmented.indexOf("?");
  if (q === -1) return { path: unfragmented, rows: [] };
  const query = unfragmented.slice(q + 1);
  const rows = [...new URLSearchParams(query)].map(([k, v]) =>
    newKeyValueRow(k, v)
  );
  return { path: unfragmented.slice(0, q), rows };
}

/** #808: the endpoint form's two key/value tables. */
export type ParamField = "queryParams" | "totalCountParams";

/**
 * #808: a draft whose Path carries `?…` (or `path`, when given) gets a clean
 * path, with its query appended as `queryParams` rows. Used on paste, on
 * blur, on submit and when the form opens.
 */
export function withSplitPath<
  D extends { path: string; queryParams: KeyValueRow[] },
>(draft: D, path = draft.path): D {
  const split = splitPathQuery(path);
  return {
    ...draft,
    path: split.path,
    queryParams: [...draft.queryParams, ...split.rows],
  };
}

/**
 * #808: the endpoint config's `queryParams`, spread into the create body and
 * the preview/probe request: `{ queryParams }` when any row survives,
 * otherwise nothing (the field stays absent, as before).
 */
export function queryParamsConfig(rows: KeyValueRow[]): {
  queryParams?: Record<string, string>;
} {
  const queryParams = keyValueRowsToRecord(rows);
  return Object.keys(queryParams).length > 0 ? { queryParams } : {};
}

/** Pagination tokens the sync substitutes per page, as `URLSearchParams`
 *  encodes them; the server allows spaces inside the braces. */
const TEMPLATE_TOKEN =
  /%7B%7B((?:\+|%20)*)(cursor|pageNumber)((?:\+|%20)*)%7D%7D/g;
const encodedSpaces = (s: string) => s.replace(/\+|%20/g, " ");

/**
 * #808: the request line the params produce, encoded exactly as the
 * adapter's `buildUrl` sends it (`URL.searchParams`, so a space is `+`).
 * `{{cursor}}` / `{{pageNumber}}` stay readable: they're substituted per
 * page before encoding.
 */
export function previewRequestUrl(path: string, rows: KeyValueRow[]): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(keyValueRowsToRecord(rows))) {
    params.set(k, v);
  }
  const query = params
    .toString()
    .replace(
      TEMPLATE_TOKEN,
      (_m, before: string, name: string, after: string) =>
        `{{${encodedSpaces(before)}${name}${encodedSpaces(after)}}}`
    );
  if (query === "") return path;
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

// ── Templating lint ─────────────────────────────────────────────────

const KNOWN_TEMPLATE_VARIABLES = new Set(["cursor", "pageNumber"]);

/**
 * Scan a string for `{{name}}` placeholders. Returns an entry for the
 * first unknown variable (or empty name). Used by the endpoint form to
 * reject saves with bad placeholders before they reach the backend
 * (the backend would also reject via REST_API_TEMPLATE_UNKNOWN_VARIABLE).
 */
export function validatePlaceholders(value: string):
  | {
      ok: true;
    }
  | {
      ok: false;
      name: string;
      message: string;
    } {
  const pattern = /\{\{\s*([a-zA-Z_]\w*)?\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const name = (match[1] ?? "").trim();
    if (!KNOWN_TEMPLATE_VARIABLES.has(name)) {
      return {
        ok: false,
        name,
        message:
          name === ""
            ? "Empty template placeholder {{}} is not allowed"
            : `Unknown template variable "${name}". Allowed: cursor, pageNumber.`,
      };
    }
  }
  return { ok: true };
}

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
  else if (input.name.trim().length > NAME_MAX_LENGTH)
    errors.name = tooLongMessage("Name", NAME_MAX_LENGTH);
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

/**
 * #808: a param value is templated per page on the server, so an unknown or
 * empty `{{…}}` would fail every sync. Lint it here, on the row it's in.
 */
function validateParamTemplates(
  rows: KeyValueRow[],
  field: ParamField
): FormErrors {
  const errors: FormErrors = {};
  for (const row of rows) {
    const check = validatePlaceholders(row.value);
    if (!check.ok) {
      errors[keyValueRowValueErrorKey(field, row.id)] = check.message;
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
  transform?: string;
  idField: string;
  bodyTemplate?: string;
  pagination?: PaginationDraft;
  queryParams?: KeyValueRow[];
  totalCountParams?: KeyValueRow[];
  totalCountPath?: string;
}): FormErrors {
  const errors: FormErrors = {
    ...validateKeyValueRows(input.queryParams ?? [], "queryParams"),
    ...validateKeyValueRows(input.totalCountParams ?? [], "totalCountParams"),
    ...validateParamTemplates(input.queryParams ?? [], "queryParams"),
    ...validateParamTemplates(input.totalCountParams ?? [], "totalCountParams"),
  };
  if (!input.key.trim()) errors.key = "Key is required";
  else if (input.key.trim().length > KEY_MAX_LENGTH)
    errors.key = tooLongMessage("Key", KEY_MAX_LENGTH);
  if (!input.label.trim()) errors.label = "Label is required";
  else if (input.label.trim().length > NAME_MAX_LENGTH)
    errors.label = tooLongMessage("Label", NAME_MAX_LENGTH);

  // #458: count params without a response path leave the probe unreadable.
  const totalCountParams = input.totalCountParams ?? [];
  const totalCountPath = input.totalCountPath?.trim() ?? "";
  if (hasKeyValueRows(totalCountParams) && totalCountPath === "") {
    errors.totalCountPath =
      "Count response path is required when count query params are set";
  }
  const totalCount = totalCountDraftToConfig(totalCountParams, totalCountPath);

  const pagination = input.pagination
    ? paginationDraftToConfig(input.pagination)
    : { strategy: "none" as const };

  // Lint the body template before Zod sees it so we surface a more
  // actionable error than the schema's generic refine.
  const bodyTemplate = input.bodyTemplate?.trim()
    ? input.bodyTemplate
    : undefined;
  if (bodyTemplate !== undefined) {
    const check = validatePlaceholders(bodyTemplate);
    if (!check.ok) errors.bodyTemplate = check.message;
  }

  // Client-side backstop for the transform XOR recordsPath refinement
  // — the Zod schema enforces this too, but surfacing it inline with
  // a field-targeted error gives the user a clearer fix path than the
  // generic schema message.
  const transform = input.transform?.trim() ?? "";
  const recordsPath = input.recordsPath ?? "";
  if (transform.length > 0 && recordsPath.length > 0) {
    errors.transform =
      "Transform and Records path cannot both be set; clear one to continue.";
  }

  const result = validateWithSchema(ApiEndpointConfigSchema, {
    path: input.path,
    ...queryParamsConfig(input.queryParams ?? []),
    method: input.method,
    recordsPath: input.recordsPath,
    ...(transform.length > 0 ? { transform } : {}),
    idField: input.idField || null,
    ...(bodyTemplate !== undefined ? { bodyTemplate } : {}),
    pagination,
    ...(totalCount !== undefined ? { totalCount } : {}),
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

// ── Probe-review column rows ────────────────────────────────────────

/**
 * One reviewed column row held in the workflow's ProbeReviewStep
 * state. Mirrors the per-column shape persisted as a `field_mapping`
 * on commit. `columnDefinitionId` is the existing column definition the
 * row maps (#838: an endpoint never creates one), set by adopting an
 * AI-assist suggestion or picking one.
 */
export interface ColumnRowDraft {
  sourceField: string;
  normalizedKey: string;
  required: boolean;
  samples: unknown[];
  columnDefinitionId?: string | null;
  suggestion?: ApiColumnSuggestion;
}

/**
 * Apply a row's AI-assist suggestion: its normalized key, and its column
 * definition when it found one. A suggestion with no catalog match
 * (`columnDefinitionId: null`) keeps the definition the user picked (#838).
 */
export function adoptSuggestion(row: ColumnRowDraft): ColumnRowDraft {
  if (!row.suggestion) return row;
  return {
    ...row,
    normalizedKey: row.suggestion.suggestedNormalizedKey,
    columnDefinitionId:
      row.suggestion.columnDefinitionId ?? row.columnDefinitionId,
  };
}

/**
 * Per-endpoint column-row validator used by the ProbeReviewStep
 * before allowing the user to advance:
 *   - every row's `normalizedKey` is non-empty and snake_case-ish;
 *   - `normalizedKey` is unique within the endpoint;
 *   - every row names a column definition (#838).
 *
 * Returns row-indexed error keys (`row-<i>-normalizedKey`,
 * `row-<i>-columnDefinitionId`) so the table can highlight the offending
 * cell.
 */
export function validateColumnRows(rows: ColumnRowDraft[]): FormErrors {
  const errors: FormErrors = {};
  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    if (!row.columnDefinitionId) {
      errors[`row-${index}-columnDefinitionId`] = "Pick a column definition";
    }
    const key = row.normalizedKey.trim();
    if (!key) {
      errors[`row-${index}-normalizedKey`] = "Normalized key is required";
      return;
    }
    if (key.length > KEY_MAX_LENGTH) {
      errors[`row-${index}-normalizedKey`] = tooLongMessage(
        "Normalized key",
        KEY_MAX_LENGTH
      );
      return;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      errors[`row-${index}-normalizedKey`] =
        "Must be snake_case (lowercase letters, digits, underscores)";
      return;
    }
    if (seen.has(key)) {
      errors[`row-${index}-normalizedKey`] = "Duplicate normalized key";
      const prev = seen.get(key)!;
      errors[`row-${prev}-normalizedKey`] = "Duplicate normalized key";
    } else {
      seen.set(key, index);
    }
  });
  return errors;
}
