import { describe, it, expect } from "@jest/globals";

import { isEmailVerified } from "../../utils/email-verified.util.js";

describe("isEmailVerified", () => {
  it("accepts the boolean true", () => {
    expect(isEmailVerified(true)).toBe(true);
  });

  // An enterprise connection's attribute mapping stringifies the claim (#916:
  // Okta through Auth0's use_map arrives as "true").
  it("accepts the string true, in any case and padding", () => {
    expect(isEmailVerified("true")).toBe(true);
    expect(isEmailVerified(" TRUE ")).toBe(true);
  });

  it("refuses the string false, which is truthy", () => {
    expect(isEmailVerified("false")).toBe(false);
  });

  it.each([false, undefined, null, "", "yes", "1", 1, {}, []])(
    "refuses %p",
    (value) => {
      expect(isEmailVerified(value)).toBe(false);
    }
  );
});
