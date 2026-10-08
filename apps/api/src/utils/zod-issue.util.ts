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
