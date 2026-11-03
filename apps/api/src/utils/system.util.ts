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

export const SYSTEM_ID_REQUIRED =
  "SYSTEM_ID is required: the system principal for platform-created rows";

/**
 * The system principal, or a throw naming SYSTEM_ID when it's unset or blank
 * (#948). Every entry point (the API, `db/seed.ts`, `db:upgrade`) then fails
 * with the same message instead of a `createdBy` validation error at the first
 * platform write. The API's boot guard (`config/deploy-mode.ts`) checks it too,
 * so the server refuses to start rather than fail at first sign-in.
 */
export function requireSystemId(value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(SYSTEM_ID_REQUIRED);
  }
  return value;
}

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
      // A getter, so reading `id.v4` never trips the check.
      get system() {
        return requireSystemId(environment.SYSTEM_ID);
      },
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
