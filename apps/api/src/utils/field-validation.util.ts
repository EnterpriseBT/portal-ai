export function validateRequired(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return "Required field is missing";
  }
  return null;
}

export function validatePattern(
  value: unknown,
  pattern: string,
  message?: string | null,
): string | null {
  if (value === null || value === undefined) return null;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    // Invalid regex — skip validation rather than crash the import
    return null;
  }
  if (!regex.test(String(value))) {
    return message ?? `Does not match pattern ${pattern}`;
  }
  return null;
}

export function validateEnum(
  value: unknown,
  enumValues: string[],
): string | null {
  if (value === null || value === undefined) return null;
  if (!enumValues.includes(String(value))) {
    return `Value '${value}' is not one of: ${enumValues.join(", ")}`;
  }
  return null;
}
