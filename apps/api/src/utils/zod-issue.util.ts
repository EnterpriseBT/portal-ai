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
 * #745: how much of a schema failure a 400 echoes. Without a cap the response
 * scales with the body: an 800 KB array of bad items answered 51 MB of issues,
 * and a strict body naming 460,000 unknown keys listed each one twice (12 MB,
 * and the whole list in the error log line). Past the caps the client still
 * has the first failures and `issueCount`, which is enough to fix the request.
 */
export const MAX_ECHOED_ISSUES = 20;
export const MAX_ECHOED_KEYS = 20;
export const MAX_ECHOED_KEY_LENGTH = 64;

const clipKey = (key: string): string =>
  key.length > MAX_ECHOED_KEY_LENGTH
    ? `${key.slice(0, MAX_ECHOED_KEY_LENGTH)}…`
    : key;

/** An unrecognized-keys issue with its key list capped and each name clipped. */
function boundIssue(issue: z.core.$ZodIssue): z.core.$ZodIssue {
  if (issue.code !== "unrecognized_keys") return issue;
  const tooMany = issue.keys.length > MAX_ECHOED_KEYS;
  const tooLong = issue.keys.some((k) => k.length > MAX_ECHOED_KEY_LENGTH);
  if (!tooMany && !tooLong) return issue;
  const keys = issue.keys.slice(0, MAX_ECHOED_KEYS).map(clipKey);
  const listed = keys.map((k) => `"${k}"`).join(", ");
  const more = issue.keys.length - keys.length;
  return {
    ...issue,
    keys,
    message: `Unrecognized key${issue.keys.length > 1 ? "s" : ""}: ${listed}${more > 0 ? ` and ${more} more` : ""}`,
  };
}

/**
 * #742, #745: the 400 for a request body or query that fails its schema, and
 * the only way a route answers one. It names the domain's `*_INVALID_PAYLOAD`
 * code for a body and `*_INVALID_QUERY` for a query, never a `*_NOT_FOUND`
 * one: a bad body is not a missing object. The first issue is in the message,
 * and up to {@link MAX_ECHOED_ISSUES} are in `details.issues`, with the
 * total in `details.issueCount`. Label a body
 * `"Invalid <thing> payload"` and a query `"Invalid <thing> query"`.
 * `invalid-request-code.guard.test.ts` fails CI on a hand-built 400 in an
 * `if (!x.success)` branch, or on a `*_NOT_FOUND` code here.
 */
export function invalidPayload(
  code: ApiCode,
  label: string,
  error: z.ZodError
): ApiError {
  const issues = error.issues.slice(0, MAX_ECHOED_ISSUES).map(boundIssue);
  return new ApiError(
    400,
    code,
    `${label}: ${describeFirstZodIssue(issues, "invalid body")}`,
    { issues, issueCount: error.issues.length }
  );
}
