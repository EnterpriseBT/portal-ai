import type { ZodType } from "zod";

export type FormErrors = Record<string, string>;

export function validateWithSchema<T>(
  schema: ZodType<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: FormErrors } {
  const result = schema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  const errors: FormErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".");
    if (!errors[key]) errors[key] = issue.message;
  }
  return { success: false, errors };
}
