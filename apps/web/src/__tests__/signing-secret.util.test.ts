import { SigningSecretSchema } from "@portalai/core/contracts";

import { generateSigningSecret } from "../utils/signing-secret.util";

describe("generateSigningSecret (#911)", () => {
  it("produces a secret the register contract accepts", () => {
    for (let i = 0; i < 20; i++) {
      expect(
        SigningSecretSchema.safeParse(generateSigningSecret()).success
      ).toBe(true);
    }
  });

  it("produces a different secret on each call", () => {
    expect(generateSigningSecret()).not.toBe(generateSigningSecret());
  });
});
