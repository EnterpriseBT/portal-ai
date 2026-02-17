import * as dateFns from "date-fns";
import { TZDate, tz } from "@date-fns/tz";

/**
 * Factory that wraps date-fns with a fixed IANA time zone.
 *
 * Every date-fns function that supports the `in` context option will
 * automatically operate in the configured time zone, and helper methods
 * always return `TZDate` instances bound to it.
 *
 * @example
 * ```ts
 * const dates = new DateFactory("America/New_York");
 *
 * // current moment in New York
 * const now = dates.now();
 *
 * // date-fns functions — timezone is injected automatically
 * const formatted = dates.fns.format(now, "yyyy-MM-dd HH:mm:ssXXX");
 * const tomorrow  = dates.fns.addDays(now, 1);
 * ```
 */
export class DateFactory {
  /** IANA time zone identifier (e.g. `"America/New_York"`). */
  readonly timeZone: string;

  /**
   * A context function (`in`) that date-fns uses to construct dates
   * in the configured time zone.
   *
   * Pass it directly to any date-fns option bag:
   * ```ts
   * dateFns.startOfDay(date, { in: factory.tzContext });
   * ```
   */
  readonly tzContext: ReturnType<typeof tz>;

  /**
   * The full date-fns module, re-exported for convenience so that
   * consumers do not need a separate import.
   */
  readonly fns = dateFns;

  /**
   * Creates a new `DateFactory` bound to the given IANA time zone.
   *
   * @param timeZone - IANA time zone name (e.g. `"Europe/London"`)
   *                   or UTC offset (e.g. `"+05:30"`).
   * @throws {Error} If `timeZone` is empty.
   */
  constructor(timeZone: string) {
    if (!timeZone) {
      throw new Error("A valid IANA time zone identifier is required.");
    }
    this.timeZone = timeZone;
    this.tzContext = tz(timeZone);
  }

  // ---------------------------------------------------------------------------
  // Convenience helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the current instant as a `TZDate` in the configured time zone.
   */
  now(): TZDate {
    return TZDate.tz(this.timeZone);
  }

  /**
   * Converts an arbitrary `Date`, timestamp, or ISO string into a
   * `TZDate` in the configured time zone.
   *
   * @param value - A `Date` object, Unix-ms timestamp, or date-time string.
   */
  toTZDate(value: Date | number | string): TZDate {
    return new TZDate(value as Date, this.timeZone);
  }

  // ---------------------------------------------------------------------------
  // Commonly used date-fns wrappers (timezone pre-applied)
  // ---------------------------------------------------------------------------

  /**
   * Formats a date in the configured time zone.
   *
   * @see {@link dateFns.format}
   */
  format(date: Date | number | string, formatStr: string): string {
    return dateFns.format(this.toTZDate(date), formatStr);
  }

  /**
   * Adds a Duration to a date, returning a `TZDate` in the configured
   * time zone.
   *
   * @see {@link dateFns.add}
   */
  add(date: Date | number | string, duration: dateFns.Duration): TZDate {
    return dateFns.add(this.toTZDate(date), duration, {
      in: this.tzContext,
    }) as TZDate;
  }

  /**
   * Subtracts a Duration from a date, returning a `TZDate` in the configured
   * time zone.
   *
   * @see {@link dateFns.sub}
   */
  sub(date: Date | number | string, duration: dateFns.Duration): TZDate {
    return dateFns.sub(this.toTZDate(date), duration, {
      in: this.tzContext,
    }) as TZDate;
  }

  /**
   * Returns the start of day in the configured time zone.
   *
   * @see {@link dateFns.startOfDay}
   */
  startOfDay(date: Date | number | string): TZDate {
    return dateFns.startOfDay(this.toTZDate(date), {
      in: this.tzContext,
    }) as TZDate;
  }

  /**
   * Returns the end of day in the configured time zone.
   *
   * @see {@link dateFns.endOfDay}
   */
  endOfDay(date: Date | number | string): TZDate {
    return dateFns.endOfDay(this.toTZDate(date), {
      in: this.tzContext,
    }) as TZDate;
  }

  /**
   * Checks whether two dates fall on the same day in the configured time zone.
   *
   * @see {@link dateFns.isSameDay}
   */
  isSameDay(
    dateLeft: Date | number | string,
    dateRight: Date | number | string
  ): boolean {
    return dateFns.isSameDay(this.toTZDate(dateLeft), this.toTZDate(dateRight));
  }

  /**
   * Returns the signed difference in calendar days between two dates
   * in the configured time zone.
   *
   * @see {@link dateFns.differenceInCalendarDays}
   */
  differenceInCalendarDays(
    dateLeft: Date | number | string,
    dateRight: Date | number | string
  ): number {
    return dateFns.differenceInCalendarDays(
      this.toTZDate(dateLeft),
      this.toTZDate(dateRight)
    );
  }
}
