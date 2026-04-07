import type { SelectOption } from "@portalai/core/ui";

// ── Canonical Format Options ────────────────────────────────────────

export const STRING_CANONICAL_FORMAT_OPTIONS: SelectOption[] = [
  { value: "", label: "None" },
  { value: "lowercase", label: "Lowercase — e.g. jane@example.com" },
  { value: "uppercase", label: "Uppercase — e.g. US" },
  { value: "trim", label: "Trim — removes leading/trailing whitespace" },
  { value: "phone", label: "Phone — normalizes to +1XXXXXXXXXX" },
];

export const NUMBER_CANONICAL_FORMAT_OPTIONS: SelectOption[] = [
  { value: "", label: "None" },
  { value: "$#,##0.00", label: "USD — $1,234.56" },
  { value: "€#,##0.00", label: "EUR — €1,234.56" },
  { value: "£#,##0.00", label: "GBP — £1,234.56" },
  { value: "¥#,##0", label: "JPY — ¥1,234" },
  { value: "#,##0.00", label: "2 decimals — 1,234.56" },
  { value: "#,##0.000", label: "3 decimals — 1,234.567" },
  { value: "#,##0", label: "Integer — 1,234" },
];

// ── Validation Presets ──────────────────────────────────────────────

export const VALIDATION_PRESETS: SelectOption[] = [
  { value: "", label: "None" },
  { value: "email", label: "Email" },
  { value: "url", label: "URL" },
  { value: "phone", label: "Phone" },
  { value: "uuid", label: "UUID" },
];

export const VALIDATION_PRESET_VALUES: Record<string, { pattern: string; message: string }> = {
  "": { pattern: "", message: "" },
  email: { pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", message: "Must be a valid email address" },
  url: { pattern: "^https?://.*", message: "Must be a valid URL" },
  phone: { pattern: "^\\+?[\\d\\s\\-().]+$", message: "Must be a valid phone number" },
  uuid: { pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", message: "Must be a valid UUID" },
};

// ── Type Field Configuration ────────────────────────────────────────

export interface TypeFieldConfig {
  format: { enabled: boolean; helperText: string };
  validation: { enabled: boolean };
  canonicalFormat: { enabled: boolean; options: SelectOption[] };
}

export const TYPE_FIELD_CONFIG: Record<string, TypeFieldConfig> = {
  string: {
    format: { enabled: false, helperText: "Not used for string columns" },
    validation: { enabled: true },
    canonicalFormat: { enabled: true, options: STRING_CANONICAL_FORMAT_OPTIONS },
  },
  number: {
    format: { enabled: true, helperText: "e.g. currency for 2 decimals, precision:N for N decimals, eu for European format (1.234,56)" },
    validation: { enabled: true },
    canonicalFormat: { enabled: true, options: NUMBER_CANONICAL_FORMAT_OPTIONS },
  },
  boolean: {
    format: { enabled: true, helperText: "Custom true:false labels. e.g. active:inactive, yes:no, 1:0" },
    validation: { enabled: false },
    canonicalFormat: { enabled: false, options: [] },
  },
  date: {
    format: { enabled: true, helperText: "Date format for parsing. e.g. yyyy-MM-dd, MM/dd/yyyy, dd.MM.yyyy" },
    validation: { enabled: false },
    canonicalFormat: { enabled: false, options: [] },
  },
  datetime: {
    format: { enabled: true, helperText: "Datetime format for parsing. e.g. yyyy-MM-dd HH:mm:ss, MM/dd/yyyy hh:mm a" },
    validation: { enabled: false },
    canonicalFormat: { enabled: false, options: [] },
  },
  enum: {
    format: { enabled: false, helperText: "Not used for enum columns" },
    validation: { enabled: true },
    canonicalFormat: { enabled: false, options: [] },
  },
  json: {
    format: { enabled: false, helperText: "Not used for JSON columns" },
    validation: { enabled: false },
    canonicalFormat: { enabled: false, options: [] },
  },
  array: {
    format: { enabled: true, helperText: "Delimiter character for splitting values. Default is comma (,). e.g. | for pipe-delimited" },
    validation: { enabled: false },
    canonicalFormat: { enabled: false, options: [] },
  },
  reference: {
    format: { enabled: false, helperText: "Not used for reference columns" },
    validation: { enabled: false },
    canonicalFormat: { enabled: false, options: [] },
  },
  "reference-array": {
    format: { enabled: true, helperText: "Delimiter character for splitting values. Default is comma (,). e.g. | for pipe-delimited" },
    validation: { enabled: false },
    canonicalFormat: { enabled: false, options: [] },
  },
};

export const DEFAULT_TYPE_CONFIG: TypeFieldConfig = {
  format: { enabled: true, helperText: "How to parse raw source values" },
  validation: { enabled: true },
  canonicalFormat: { enabled: true, options: STRING_CANONICAL_FORMAT_OPTIONS },
};

// ── Helpers ─────────────────────────────────────────────────────────

/** Look up the preset key that matches a given pattern, or "" if none match. */
export function findPresetByPattern(pattern: string | null): string {
  if (!pattern) return "";
  for (const [key, val] of Object.entries(VALIDATION_PRESET_VALUES)) {
    if (key && val.pattern === pattern) return key;
  }
  return "";
}

/** Validate that a string is a valid regular expression. Returns error message or null. */
export function validateRegex(pattern: string): string | null {
  if (!pattern) return null;
  try {
    new RegExp(pattern);
    return null;
  } catch {
    return "Invalid regular expression";
  }
}

/** Get the type field config for a given column data type. */
export function getTypeConfig(type: string): TypeFieldConfig {
  return TYPE_FIELD_CONFIG[type] ?? DEFAULT_TYPE_CONFIG;
}
