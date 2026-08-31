import { describe, it, expect } from "@jest/globals";
import { UUIDv4Factory, DateFactory } from "@portalai/core/utils";
import { SystemUtilities } from "../../utils/system.util.js";
import { environment } from "../../environment.js";

// ── Helpers ─────────────────────────────────────────────────────────

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── id ──────────────────────────────────────────────────────────────

describe("SystemUtilities.id", () => {
  describe("v4", () => {
    it("is a UUIDv4Factory instance", () => {
      expect(SystemUtilities.id.v4).toBeInstanceOf(UUIDv4Factory);
    });

    it("generate() returns a valid UUID", () => {
      expect(SystemUtilities.id.v4.generate()).toMatch(UUID_REGEX);
    });

    it("generate() returns unique values on each call", () => {
      const ids = new Set(
        Array.from({ length: 100 }, () => SystemUtilities.id.v4.generate())
      );
      expect(ids.size).toBe(100);
    });

    it("returns the same singleton instance across accesses", () => {
      expect(SystemUtilities.id.v4).toBe(SystemUtilities.id.v4);
    });

    it("system returns the SYSTEM_ID from environment", () => {
      expect(SystemUtilities.id.system).toBe(environment.SYSTEM_ID);
    });
  });
});

// ── utc ─────────────────────────────────────────────────────────────

describe("SystemUtilities.utc", () => {
  it("is a DateFactory instance", () => {
    expect(SystemUtilities.utc).toBeInstanceOf(DateFactory);
  });

  it("is bound to the UTC timezone", () => {
    expect(SystemUtilities.utc.timeZone).toBe("UTC");
  });

  it("now() returns a date", () => {
    const now = SystemUtilities.utc.now();
    expect(now).toBeInstanceOf(Date);
  });

  it("returns the same singleton instance across accesses", () => {
    expect(SystemUtilities.utc).toBe(SystemUtilities.utc);
  });
});

// ── tz() ────────────────────────────────────────────────────────────

describe("SystemUtilities.tz()", () => {
  it("returns a DateFactory for the given timezone", () => {
    const eastern = SystemUtilities.tz("America/New_York");
    expect(eastern).toBeInstanceOf(DateFactory);
    expect(eastern.timeZone).toBe("America/New_York");
  });

  it("returns a distinct instance on each call", () => {
    const a = SystemUtilities.tz("America/Chicago");
    const b = SystemUtilities.tz("America/Chicago");
    expect(a).not.toBe(b);
  });

  it("now() returns a date in the specified timezone", () => {
    const tokyo = SystemUtilities.tz("Asia/Tokyo");
    const now = tokyo.now();
    expect(now).toBeInstanceOf(Date);
  });
});
