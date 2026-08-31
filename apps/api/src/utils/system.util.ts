/**
 * Centralized access to core ID and date factories for the API layer.
 *
 * Provides pre-configured singleton instances so that route handlers and
 * services can generate IDs and work with dates without instantiating
 * factories themselves.
 *
 * @example
 * ```ts
 * import { SystemUtilities } from "../utils/system.util.js";
 *
 * // random UUID
 * const id = SystemUtilities.id.v4.generate();
 *
 * // current UTC timestamp
 * const now = SystemUtilities.date.now();
 * ```
 */

import { UUIDv4Factory, DateFactory } from "@portalai/core/utils";
import { environment } from "../environment.js";

/** Default timezone for the date factory. */
const DEFAULT_TIMEZONE = "UTC";

export class SystemUtilities {
  private static readonly _v4Factory = new UUIDv4Factory();
  private static readonly _dateFactory = new DateFactory(DEFAULT_TIMEZONE);

  /**
   * ID generation factories.
   *
   * - `system` — the system-actor id used as `createdBy`/`updatedBy` for
   *   platform-initiated writes
   * - `v4` — random, cryptographically-secure UUIDs
   */
  static get id() {
    return {
      system: environment.SYSTEM_ID!,
      v4: this._v4Factory,
    };
  }

  static get timezone() {
    return DEFAULT_TIMEZONE;
  }

  /**
   * Date factory bound to UTC by default.
   *
   * - `utc` — the default UTC {@link DateFactory}
   * - `createDateFactory(timeZone)` — create a factory for a specific IANA zone
   */
  static get utc() {
    return this._dateFactory;
  }

  /**
   * Create a {@link DateFactory} for a specific IANA time zone.
   *
   * @param timeZone - IANA time zone name (e.g. `"America/New_York"`)
   */
  static tz(timeZone: string): DateFactory {
    return new DateFactory(timeZone);
  }
}
