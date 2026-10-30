import { describe, it, expect } from "@jest/globals";

import {
  Auth0UserProfileSchema,
  parseBooleanClaim,
} from "../../contracts/auth.contract.js";

describe("parseBooleanClaim", () => {
  it.each([
    [true, true],
    [false, false],
    ["true", true],
    ["false", false],
    [" TRUE ", true],
    ["False", false],
  ])("reads %p as %p", (value, expected) => {
    expect(parseBooleanClaim(value)).toBe(expected);
  });

  it.each([undefined, null, "", "yes", "1", 1, {}])(
    "leaves %p unparsed",
    (value) => {
      expect(parseBooleanClaim(value)).toBeUndefined();
    }
  );
});

describe("Auth0UserProfileSchema", () => {
  // #916: Auth0 returns an enterprise connection's mapped claims as strings.
  it("reads a string email_verified as a boolean", () => {
    const parsed = Auth0UserProfileSchema.parse({
      sub: "oidc|smoke-sso|abc",
      email_verified: "true",
      phone_number_verified: "false",
    });
    expect(parsed.email_verified).toBe(true);
    expect(parsed.phone_number_verified).toBe(false);
  });

  it("keeps a boolean email_verified and allows it missing", () => {
    expect(
      Auth0UserProfileSchema.parse({ sub: "a|b", email_verified: false })
        .email_verified
    ).toBe(false);
    expect(
      Auth0UserProfileSchema.parse({ sub: "a|b" }).email_verified
    ).toBeUndefined();
  });

  it("refuses an email_verified that is neither boolean nor true/false", () => {
    expect(
      Auth0UserProfileSchema.safeParse({ sub: "a|b", email_verified: "yes" })
        .success
    ).toBe(false);
  });
});
