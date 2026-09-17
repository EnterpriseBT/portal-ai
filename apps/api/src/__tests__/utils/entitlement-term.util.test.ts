import { describe, it, expect } from "@jest/globals";
import { isEntitlementExpired } from "../../utils/entitlement-term.util.js";

describe("isEntitlementExpired (#568, case 15)", () => {
  const NOW = 1_800_000_000_000;

  it("a null term is never expired (SaaS / non-marketplace org)", () => {
    expect(isEntitlementExpired({ entitlementThrough: null }, NOW)).toBe(false);
  });

  it("a future term is not expired", () => {
    expect(
      isEntitlementExpired({ entitlementThrough: NOW + 86_400_000 }, NOW)
    ).toBe(false);
  });

  it("a past term is expired", () => {
    expect(isEntitlementExpired({ entitlementThrough: NOW - 1 }, NOW)).toBe(
      true
    );
  });

  it("a term exactly at now is not yet expired (strict less-than)", () => {
    expect(isEntitlementExpired({ entitlementThrough: NOW }, NOW)).toBe(false);
  });
});
