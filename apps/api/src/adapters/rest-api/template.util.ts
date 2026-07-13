/**
 * Closed-set template substitution for the REST API connector.
 *
 * Header values, query-param values, and POST body templates may
 * reference two variables — `{{cursor}}` and `{{pageNumber}}` — that
 * the pagination loop updates between fetches. Anything else inside
 * `{{ }}` is a hard error (`REST_API_TEMPLATE_UNKNOWN_VARIABLE`).
 *
 * Closed-set semantics is what makes templating safe to ship without
 * a sandbox: the substitution surface is two known variables and the
 * names are validated at apply time + lint-time by the frontend.
 *
 * Pure functions — no I/O, no logging.
 */
import { ApiCode } from "../../constants/api-codes.constants.js";
import { ApiError } from "../../services/http.service.js";

export interface TemplateVariables {
  cursor: string;
  pageNumber: number;
}

const KNOWN_VARIABLES = new Set<keyof TemplateVariables>([
  "cursor",
  "pageNumber",
]);

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z_]\w*)?\s*\}\}/g;

/**
 * Substitute every `{{name}}` placeholder in `input` with the matching
 * value from `vars`. Throws `REST_API_TEMPLATE_UNKNOWN_VARIABLE` if any
 * placeholder name is outside the closed set (including the empty
 * name `{{}}`). Multiple placeholders in one string are all
 * substituted.
 */
export function applyTemplate(input: string, vars: TemplateVariables): string {
  return input.replace(
    PLACEHOLDER_PATTERN,
    (_match, rawName: string | undefined) => {
      const name = rawName ?? "";
      if (!KNOWN_VARIABLES.has(name as keyof TemplateVariables)) {
        throw new ApiError(
          400,
          ApiCode.REST_API_TEMPLATE_UNKNOWN_VARIABLE,
          `Unknown template variable "${name}". Allowed: cursor, pageNumber.`,
          { name }
        );
      }
      return String(vars[name as keyof TemplateVariables]);
    }
  );
}

/**
 * Apply `applyTemplate` to every value in a `Record<string, string>`.
 * Used for `headers` + `queryParams`. Undefined input returns `{}` so
 * callers can spread the result unconditionally.
 */
export function applyTemplateToConfig(
  config: Record<string, string> | undefined,
  vars: TemplateVariables
): Record<string, string> {
  if (!config) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    out[key] = applyTemplate(value, vars);
  }
  return out;
}
