import type { ServerError } from "./api.util";

/**
 * Role/permission-denial recognition (#576) — the shared RBAC error layer.
 *
 * Kept in its own module (not `api.util`) so the many tests that mock
 * `api.util` don't need to re-declare these exports: `FormAlert` and toast
 * surfaces import the helper from here, which nothing mocks.
 */
export const PERMISSION_DENIED_CODES: ReadonlySet<string> = new Set([
  "INSUFFICIENT_ROLE",
  "ORGANIZATION_NOT_OWNER",
  "BILLING_NOT_OWNER",
  "AUDIT_LOG_NOT_AUTHORIZED",
]);

/** The standardized lead shown for any permission denial. */
export const PERMISSION_DENIED_MESSAGE =
  "You don't have permission to perform this action.";

/** Whether a `ServerError` (or a raw code) is a role/permission denial. */
export function isPermissionDenied(
  error: ServerError | string | null | undefined
): boolean {
  const code = typeof error === "string" ? error : error?.code;
  return code != null && PERMISSION_DENIED_CODES.has(code);
}
