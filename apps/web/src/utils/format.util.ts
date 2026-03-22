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

export interface CurrencyFormatOptions {
  /** ISO 4217 currency code (e.g. `"USD"`, `"EUR"`). When set, uses `Intl.NumberFormat` with currency style. */
  currency?: string;
  /** BCP 47 locale tag (default: `undefined` — uses host locale). */
  locale?: string;
  /** Minimum fraction digits (default: `2`). */
  minimumFractionDigits?: number;
  /** Maximum fraction digits (default: `2`). */
  maximumFractionDigits?: number;
}

export interface FormatOptions {
  date?: DateFormatOptions;
  datetime?: DatetimeFormatOptions;
  boolean?: BooleanFormatOptions;
  currency?: CurrencyFormatOptions;
}

// ── Formatter ───────────────────────────────────────────────────────

/**
 * Provides static formatting methods for each column data type.
 *
 * Uses {@link DateFactory} for timezone-aware date/datetime formatting.
 *
 * Use {@link Formatter.format} for type-dispatched formatting,
 * or call individual methods directly (e.g. {@link Formatter.currency}).
 */
export class Formatter {
  /**
   * Null-safe entry point — returns a dash for null/undefined values,
   * otherwise delegates to the type-specific static method.
   */
  static format(
    value: unknown,
    type: ColumnDataType,
    options?: FormatOptions
  ): string {
    if (value == null) return "—";
    switch (type) {
      case "date":
        return Formatter.date(value, options?.date);
      case "datetime":
        return Formatter.datetime(value, options?.datetime);
      case "boolean":
        return Formatter.boolean(value, options?.boolean);
      case "currency":
        return Formatter.currency(value, options?.currency);
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

  static currency(
    value: unknown,
    options?: CurrencyFormatOptions
  ): string {
    const minFrac = options?.minimumFractionDigits ?? 2;
    const maxFrac = options?.maximumFractionDigits ?? 2;
    const locale = options?.locale;

    const intlOptions: Intl.NumberFormatOptions = options?.currency
      ? {
          style: "currency",
          currency: options.currency,
          minimumFractionDigits: minFrac,
          maximumFractionDigits: maxFrac,
        }
      : {
          minimumFractionDigits: minFrac,
          maximumFractionDigits: maxFrac,
        };

    if (typeof value === "number") {
      return value.toLocaleString(locale, intlOptions);
    }
    const n = Number(value);
    if (isNaN(n)) return String(value);
    return n.toLocaleString(locale, intlOptions);
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
    currency: Formatter.currency,
  };
}
