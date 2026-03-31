import type { ZodType } from "zod";

export type FormErrors = Record<string, string>;

/**
 * Finds the first invalid field within a container (form or dialog),
 * scrolls it into view, and focuses it.
 *
 * Looks for `[aria-invalid="true"]` first, then falls back to any
 * `.Mui-error` input. Call this after setting validation errors and
 * marking fields as touched.
 */
export function focusFirstInvalidField(container?: HTMLElement | null): void {
  const root = container ?? document;
  const el =
    root.querySelector<HTMLElement>('[aria-invalid="true"]') ??
    root.querySelector<HTMLElement>(".Mui-error input, .Mui-error textarea");
  if (el) {
    el.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    el.focus();
  }
}

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
