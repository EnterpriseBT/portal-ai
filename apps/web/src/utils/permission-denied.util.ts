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

/**
 * #711: what to show for a server error. A permission refusal's message names
 * the permission ("You don't have permission to manage billing."), so a denial
 * shows it as is, or the standard lead if it's empty. Anything else shows its
 * message, or `fallback` when there's nothing to show.
 */
export function serverErrorMessage(
  error: unknown,
  fallback = "Something went wrong."
): string {
  const { message, code } = fieldsOf(error);
  const text = message?.trim();
  if (isPermissionDenied(code)) return text || PERMISSION_DENIED_MESSAGE;
  return text || fallback;
}
