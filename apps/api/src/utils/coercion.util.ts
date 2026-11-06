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

/** A whole numeric literal, once currency and grouping are stripped. */
const NUMERIC_LITERAL = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

export function coerceNumber(
  value: unknown,
  format?: string | null
): CoercionResult {
  if (isNullish(value)) return { value: null };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { value: null, error: "Expected a number" };
    }
    return applyNumberFormat(value, format);
  }

  let str = String(value).trim();
  if (str === "") return { value: null };

  // Strip currency symbols and whitespace, then the grouping separator.
  str = str.replace(/[$€£¥\s]/g, "");
  if (format && (format === "eu" || format.includes(","))) {
    // European format: 1.234,56 → 1234.56
    str = str.replace(/\./g, "").replace(",", ".");
  } else {
    str = str.replace(/,/g, "");
  }

  // #968: what's left must be wholly a number. parseFloat alone kept a
  // leading number and dropped the rest ("10 HP" → 10, "25 + 1/s" → 25),
  // losing the value silently instead of reporting it.
  // An exponent can still overflow ("1e400" → Infinity), which no numeric
  // column stores.
  const num = NUMERIC_LITERAL.test(str) ? Number(str) : NaN;
  if (!Number.isFinite(num)) {
    return { value: null, error: "Expected a number" };
  }
  return applyNumberFormat(num, format);
}

function applyNumberFormat(
  num: number,
  format?: string | null
): CoercionResult {
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
  format?: string | null
): CoercionResult {
  if (isNullish(value)) return { value: null };
  if (typeof value === "boolean") return { value };

  const str = String(value).trim().toLowerCase();
  if (str === "") return { value: null };

  // Custom label pair: "active/inactive"
  if (format && format.includes("/")) {
    const [trueLabel, falseLabel] = format.split("/");
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
  return fmt.replace(/YYYY/g, "yyyy").replace(/YY/g, "yy").replace(/DD/g, "dd");
}

/** An ISO 8601 date, optionally with a time and offset. */
const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function parseDate(value: unknown, format?: string | null): Date | null {
  // A typed spreadsheet date (#968): already a date, whatever the format.
  if (value instanceof Date) {
    return utcDateFactory.fns.isValid(value) ? value : null;
  }
  const str = String(value).trim();
  if (str === "") return null;

  try {
    if (format) {
      const normalizedFormat = normalizeDateFormat(format);
      const parsed = utcDateFactory.fns.parse(
        str,
        normalizedFormat,
        new Date(0)
      );
      if (utcDateFactory.fns.isValid(parsed)) return parsed;
      // A format describes how a text date is written. A typed spreadsheet
      // date reaches us as ISO 8601, which is unambiguous, so it still
      // parses when it doesn't match the binding's format (#968).
      if (!ISO_8601.test(str)) return null;
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
  format?: string | null
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
  format?: string | null
): CoercionResult {
  if (isNullish(value)) return { value: null };

  const parsed = parseDate(value, format);
  if (!parsed) {
    return { value: null, error: "Expected a valid datetime" };
  }
  return {
    value: utcDateFactory.format(parsed, "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"),
  };
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
  format?: string | null
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
  format?: string | null
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
  format?: string | null
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
    case "geometry":
      // #316: geometry values are JSON objects (GeoJSON or Esri JSON) — pass
      // the object through intact (or parse a JSON string). Without this arm
      // the `default` below would `String()` the object to "[object Object]",
      // which the downstream geometry audit then rejects as unparseable.
      return coerceJson(value);
    case "array":
      return coerceArray(value, format);
    case "reference":
      return coerceReference(value);
    case "reference-array":
      return coerceReferenceArray(value, format);
    default: {
      // Exhaustiveness guard (#316): every `ColumnDataType` must have an
      // explicit arm above, so `type` narrows to `never` here. Adding a new
      // column type without a coercion is then a compile error — this is what
      // would have caught the `geometry` gap that silently `String()`-ified
      // geometry objects. The `coerceString` fallback stays as a runtime
      // backstop for an out-of-contract value.
      const _exhaustive: never = type;
      void _exhaustive;
      return coerceString(value);
    }
  }
}
