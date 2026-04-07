import { DateFactory } from "@portalai/core/utils";
import type { ColumnDataType } from "@portalai/core/models";

const utcDateFactory = new DateFactory("UTC");

export interface CoercionResult {
  value: unknown;
  error?: string;
}

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

export function coerceString(value: unknown): CoercionResult {
  if (isNullish(value)) return { value: null };
  return { value: String(value) };
}

export function coerceNumber(
  value: unknown,
  format?: string | null,
): CoercionResult {
  if (isNullish(value)) return { value: null };
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { value: null, error: "Expected a number" };
    return applyNumberFormat(value, format);
  }

  let str = String(value).trim();
  if (str === "") return { value: null };

  // European format: 1.234,56 → 1234.56
  if (format && (format === "eu" || format.includes(","))) {
    str = str.replace(/\./g, "").replace(",", ".");
  } else {
    // Standard: strip currency symbols, commas, whitespace
    str = str.replace(/[$€£¥\s]/g, "").replace(/,/g, "");
  }

  const num = parseFloat(str);
  if (Number.isNaN(num)) {
    return { value: null, error: "Expected a number" };
  }
  return applyNumberFormat(num, format);
}

function applyNumberFormat(num: number, format?: string | null): CoercionResult {
  if (!format) return { value: num };
  if (format === "currency") return { value: parseFloat(num.toFixed(2)) };
  if (format.startsWith("precision:")) {
    const digits = parseInt(format.slice("precision:".length), 10);
    if (!Number.isNaN(digits) && digits >= 0) {
      return { value: parseFloat(num.toFixed(digits)) };
    }
  }
  return { value: num };
}

export function coerceBoolean(
  value: unknown,
  format?: string | null,
): CoercionResult {
  if (isNullish(value)) return { value: null };
  if (typeof value === "boolean") return { value };

  const str = String(value).trim().toLowerCase();
  if (str === "") return { value: null };

  // Custom label pair: "active:inactive"
  if (format && format.includes(":")) {
    const [trueLabel, falseLabel] = format.split(":");
    if (str === trueLabel.trim().toLowerCase()) return { value: true };
    if (str === falseLabel.trim().toLowerCase()) return { value: false };
    return {
      value: null,
      error: `Expected "${trueLabel.trim()}" or "${falseLabel.trim()}"`,
    };
  }

  const TRUTHY = new Set(["true", "yes", "1", "on"]);
  const FALSY = new Set(["false", "no", "0", "off"]);

  if (TRUTHY.has(str)) return { value: true };
  if (FALSY.has(str)) return { value: false };
  return { value: null, error: "Expected a boolean" };
}

/**
 * Normalize a user/AI-supplied date format string to date-fns tokens.
 * AI tools often emit moment.js conventions (YYYY, DD) which differ from
 * date-fns unicode tokens (yyyy, dd).  Replacing them prevents date-fns
 * from throwing RangeError on mixed week-year / calendar-date tokens.
 */
function normalizeDateFormat(fmt: string): string {
  return fmt
    .replace(/YYYY/g, "yyyy")
    .replace(/YY/g, "yy")
    .replace(/DD/g, "dd");
}

function parseDate(
  value: unknown,
  format?: string | null,
): Date | null {
  const str = String(value).trim();
  if (str === "") return null;

  try {
    if (format) {
      const normalizedFormat = normalizeDateFormat(format);
      const parsed = utcDateFactory.fns.parse(str, normalizedFormat, new Date(0));
      return utcDateFactory.fns.isValid(parsed) ? parsed : null;
    }

    // No format: try native parsing via DateFactory
    const tzDate = utcDateFactory.toTZDate(str);
    return utcDateFactory.fns.isValid(tzDate) ? tzDate : null;
  } catch {
    return null;
  }
}

export function coerceDate(
  value: unknown,
  format?: string | null,
): CoercionResult {
  if (isNullish(value)) return { value: null };

  const parsed = parseDate(value, format);
  if (!parsed) {
    return { value: null, error: "Expected a valid date" };
  }
  return { value: utcDateFactory.format(parsed, "yyyy-MM-dd") };
}

export function coerceDatetime(
  value: unknown,
  format?: string | null,
): CoercionResult {
  if (isNullish(value)) return { value: null };

  const parsed = parseDate(value, format);
  if (!parsed) {
    return { value: null, error: "Expected a valid datetime" };
  }
  return { value: utcDateFactory.format(parsed, "yyyy-MM-dd'T'HH:mm:ss.SSSXXX") };
}

export function coerceEnum(value: unknown): CoercionResult {
  if (isNullish(value)) return { value: null };
  return { value: String(value) };
}

export function coerceJson(value: unknown): CoercionResult {
  if (isNullish(value)) return { value: null };
  if (typeof value === "object") return { value };
  if (typeof value === "string") {
    try {
      return { value: JSON.parse(value) };
    } catch {
      return { value: null, error: "Invalid JSON" };
    }
  }
  return { value: null, error: "Invalid JSON" };
}

export function coerceArray(
  value: unknown,
  format?: string | null,
): CoercionResult {
  if (isNullish(value)) return { value: null };
  if (Array.isArray(value)) return { value };
  if (typeof value === "string") {
    const delimiter = format || ",";
    return { value: value.split(delimiter).map((s) => s.trim()) };
  }
  return { value: [value] };
}

export function coerceReference(value: unknown): CoercionResult {
  if (isNullish(value)) return { value: null };
  return { value: String(value) };
}

export function coerceReferenceArray(
  value: unknown,
  format?: string | null,
): CoercionResult {
  if (isNullish(value)) return { value: null };
  if (Array.isArray(value)) return { value };
  if (typeof value === "string") {
    const delimiter = format || ",";
    return { value: value.split(delimiter).map((s) => s.trim()) };
  }
  return { value: [value] };
}

export function coerce(
  type: ColumnDataType,
  value: unknown,
  format?: string | null,
): CoercionResult {
  switch (type) {
    case "string":
      return coerceString(value);
    case "number":
      return coerceNumber(value, format);
    case "boolean":
      return coerceBoolean(value, format);
    case "date":
      return coerceDate(value, format);
    case "datetime":
      return coerceDatetime(value, format);
    case "enum":
      return coerceEnum(value);
    case "json":
      return coerceJson(value);
    case "array":
      return coerceArray(value, format);
    case "reference":
      return coerceReference(value);
    case "reference-array":
      return coerceReferenceArray(value, format);
    default:
      return coerceString(value);
  }
}
