import { describe, it, expect } from "@jest/globals";

import { SsoDiscoveryRequestBodySchema } from "../../contracts/sso-discovery.contract.js";

const at = (n: number) =>
  "a".repeat(n - "@example.com".length) + "@example.com";

describe("SsoDiscoveryRequestBodySchema", () => {
  // #1101: the cap moved from an inline 320 to emailField's 254.
  it("accepts a 254-character email and rejects 255", () => {
    expect(
      SsoDiscoveryRequestBodySchema.safeParse({ email: at(254) }).success
    ).toBe(true);
    const r = SsoDiscoveryRequestBodySchema.safeParse({ email: at(255) });
    expect(r.error?.issues[0]?.message).toBe(
      "Email must be 254 characters or fewer"
    );
  });

  it("trims and keeps its format message", () => {
    expect(
      SsoDiscoveryRequestBodySchema.parse({ email: " a@b.com " }).email
    ).toBe("a@b.com");
    expect(
      SsoDiscoveryRequestBodySchema.safeParse({ email: "nope" }).error
        ?.issues[0]?.message
    ).toBe("Enter a valid email address");
  });
});
