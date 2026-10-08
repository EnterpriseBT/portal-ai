import type { z } from "zod";

import { ApiError } from "../services/http.service.js";
import type { ApiCode } from "../constants/api-codes.constants.js";

/**
 * One-line summary of the first Zod issue, so an error says what is wrong
 * (`tools.0.name: Required`, `Unrecognized key: "curatedViewIds"`) rather than
 * a generic "failed validation". An issue at the root has no path prefix.
 * Shared by the station routes (#706) and toolpack registration.
 */
export function describeFirstZodIssue(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
  fallback = "validation failed"
): string {
  const first = issues[0];
  if (!first) return fallback;
  return first.path.length > 0
    ? `${first.path.map((p) => String(p)).join(".")}: ${first.message}`
    : first.message;
}

/**
 * #742: the 400 for a body that fails its schema. It names the domain's
 * `*_INVALID_PAYLOAD` code, never a `*_NOT_FOUND` one (a bad body is not a
 * missing object; `invalid-request-code.guard.test.ts` enforces it). The first
 * issue is in the message, and all of them are in `details`.
 */
export function invalidPayload(
  code: ApiCode,
  label: string,
  error: z.ZodError
): ApiError {
  return new ApiError(
    400,
    code,
    `${label}: ${describeFirstZodIssue(error.issues, "invalid body")}`,
    { issues: error.issues }
  );
}
