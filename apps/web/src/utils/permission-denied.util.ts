import { INTERNAL_ERROR_MESSAGE } from "@portalai/core/constants";

import type { ServerError } from "./api.util";

/**
 * Permission-denial recognition and display (#576, #711), the shared error
 * layer. `FormAlert` and every toast show server errors through
 * `serverErrorMessage` (a guard test holds the toasts to it).
 *
 * Kept in its own module (not `api.util`) so the many tests that mock
 * `api.util` don't need to re-declare these exports.
 */
export const PERMISSION_DENIED_CODES: ReadonlySet<string> = new Set([
  // #711: one code for every permission refusal; its message names the
  // permission (policies govern permissions, so never a role).
  "PERMISSION_DENIED",
]);

/**
 * #1121: the code `api.util` gives a request that got no response (the API is
 * down or the connection dropped). `fetch` rejects with a browser-worded
 * `TypeError` ("Failed to fetch"), which is never shown. Declared here, beside
 * the helper that reads it, so a test's partial `api.util` mock can't drop it.
 */
export const NETWORK_ERROR_CODE = "NETWORK_ERROR";

/** What a permission denial says when the server gave no message. */
export const PERMISSION_DENIED_MESSAGE =
  "You don't have permission to perform this action.";

/** Whether a `ServerError` (or a raw code) is a permission denial. */
export function isPermissionDenied(
  error: ServerError | string | null | undefined
): boolean {
  const code = typeof error === "string" ? error : error?.code;
  return code != null && PERMISSION_DENIED_CODES.has(code);
}

/** The `message` and `code` of any error-shaped value. */
function fieldsOf(error: unknown): { message?: string; code?: string } {
  if (!error || typeof error !== "object") return {};
  const { message, code } = error as { message?: unknown; code?: unknown };
  return {
    message: typeof message === "string" ? message : undefined,
    code: typeof code === "string" ? code : undefined,
  };
}

/** What an error with nothing to show says when the caller gave no message. */
const DEFAULT_ERROR_MESSAGE = "Something went wrong.";

/**
 * #711: what to show for a server error. A permission refusal's message names
 * the permission ("You don't have permission to manage billing."), so a denial
 * shows it as is, or the standard lead if it's empty. Anything else shows its
 * message, or `fallback` when there's nothing to show (an API 500's generic
 * message counts as nothing, #687).
 *
 * #1121: a request that got no response (`NETWORK_ERROR`) says what failed
 * first: the caller's own `fallback` ("Couldn't add the tag."), then why. With
 * no fallback (`FormAlert`), it's the reason alone.
 */
export function serverErrorMessage(error: unknown, fallback?: string): string {
  const { message, code } = fieldsOf(error);
  const text = message?.trim();
  if (isPermissionDenied(code)) return text || PERMISSION_DENIED_MESSAGE;
  if (code === NETWORK_ERROR_CODE && text) {
    if (!fallback) return text;
    // Some fallbacks end without a stop ("Failed to revoke"), so the two
    // sentences don't run together.
    const lead = /[.!?]$/.test(fallback.trimEnd())
      ? fallback.trimEnd()
      : `${fallback.trimEnd()}.`;
    return `${lead} ${text}`;
  }
  // #687: every API 500 answers with the same generic message, so the call
  // site's own fallback ("Couldn't delete the station.") says more.
  if (text === INTERNAL_ERROR_MESSAGE) return fallback ?? DEFAULT_ERROR_MESSAGE;
  return text || (fallback ?? DEFAULT_ERROR_MESSAGE);
}
