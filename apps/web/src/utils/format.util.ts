import type { ColumnDataType } from "@portalai/core/models";
import { DateFactory } from "@portalai/core/utils";

const dates = new DateFactory("UTC");

// ── Options ─────────────────────────────────────────────────────────

export interface DateFormatOptions {
  /** date-fns format string (default: `"yyyy-MM-dd"`). */
  format?: string;
}

export interface DatetimeFormatOptions {
  /** date-fns format string (default: `"yyyy-MM-dd HH:mm:ss"`). */
  format?: string;
}

export interface BooleanFormatOptions {
  /** Label for truthy values (default: `"Yes"`). */
  trueLabel?: string;
  /** Label for falsy values (default: `"No"`). */
  falseLabel?: string;
}

export interface FormatOptions {
  date?: DateFormatOptions;
  datetime?: DatetimeFormatOptions;
  boolean?: BooleanFormatOptions;
}

// ── Formatter ───────────────────────────────────────────────────────

/**
 * Provides static formatting methods for each column data type.
 *
 * Uses {@link DateFactory} for timezone-aware date/datetime formatting.
 *
 * Use {@link Formatter.format} for type-dispatched formatting,
 * or call individual methods directly (e.g. {@link Formatter.number}).
 */
export class Formatter {
  /**
   * Null-safe entry point — returns a dash for null/undefined values,
   * otherwise delegates to the type-specific static method.
   *
   * When `canonicalFormat` is provided, it overrides the default format
   * for date/datetime types and applies display formatting for numbers.
   */
  static format(
    value: unknown,
    type: ColumnDataType,
    options?: FormatOptions & { canonicalFormat?: string | null }
  ): string {
    if (value == null) return "—";
    const cf = options?.canonicalFormat;
    switch (type) {
      case "date":
        return Formatter.date(value, cf ? { format: cf } : options?.date);
      case "datetime":
        return Formatter.datetime(value, cf ? { format: cf } : options?.datetime);
      case "boolean":
        return Formatter.boolean(value, options?.boolean);
      case "number":
        if (cf) return Formatter.numberWithFormat(value, cf);
        return Formatter.number(value);
      default:
        return this.formatters[type](value);
    }
  }

  static string(value: unknown): string {
    return String(value);
  }

  static number(value: unknown): string {
    if (typeof value === "number") return value.toLocaleString();
    const n = Number(value);
    return isNaN(n) ? String(value) : n.toLocaleString();
  }

  /**
   * Format a number using a canonical format pattern.
   * Supports currency-style prefixes (e.g., `"$#,##0.00"`) and
   * fixed-decimal patterns (e.g., `"#,##0.00"`).
   */
  static numberWithFormat(value: unknown, canonicalFormat: string): string {
    const n = typeof value === "number" ? value : Number(value);
    if (isNaN(n)) return String(value);

    // Extract prefix (e.g., "$", "€") and decimal places from pattern
    const prefixMatch = canonicalFormat.match(/^([^#0]*)/);
    const prefix = prefixMatch?.[1] ?? "";
    const decimalMatch = canonicalFormat.match(/\.([0#]+)$/);
    const decimals = decimalMatch ? decimalMatch[1].length : undefined;

    const formatted =
      decimals !== undefined
        ? n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
        : n.toLocaleString();

    return `${prefix}${formatted}`;
  }

  static boolean(
    value: unknown,
    options?: BooleanFormatOptions
  ): string {
    const trueLabel = options?.trueLabel ?? "Yes";
    const falseLabel = options?.falseLabel ?? "No";
    return value ? trueLabel : falseLabel;
  }

  static date(value: unknown, options?: DateFormatOptions): string {
    try {
      const fmt = options?.format ?? "yyyy-MM-dd";
      return dates.format(value as string | number, fmt);
    } catch {
      return String(value);
    }
  }

  static datetime(
    value: unknown,
    options?: DatetimeFormatOptions
  ): string {
    try {
      const fmt = options?.format ?? "yyyy-MM-dd HH:mm:ss";
      return dates.format(value as string | number, fmt);
    } catch {
      return String(value);
    }
  }

  static enum(value: unknown): string {
    return String(value);
  }

  static json(value: unknown): string {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  static array(value: unknown): string {
    if (Array.isArray(value)) return value.join(", ");
    return String(value);
  }

  static reference(value: unknown): string {
    return String(value);
  }

  private static readonly formatters: Record<
    ColumnDataType,
    (value: unknown) => string
  > = {
    string: Formatter.string,
    number: Formatter.number,
    boolean: Formatter.boolean,
    date: Formatter.date,
    datetime: Formatter.datetime,
    enum: Formatter.enum,
    json: Formatter.json,
    array: Formatter.array,
    reference: Formatter.reference,
    "reference-array": Formatter.array,
  };
}
