/**
 * Allowlist of permitted column definition type transitions.
 *
 * If a type is not listed as a key, no transitions are allowed from it.
 * Transitions to or from "reference" and "reference-array" are always
 * blocked regardless of this map.
 */
export const ALLOWED_TYPE_TRANSITIONS: Record<string, string[]> = {
  string: ["enum"],
  enum: ["string"],
  date: ["datetime"],
  datetime: ["date"],
};

/** Types that cannot be transitioned to or from under any circumstance. */
export const BLOCKED_TYPES = ["reference", "reference-array"] as const;
