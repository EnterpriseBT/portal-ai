/**
 * #956: SYSTEM_ID is write-once. The database records the principal it was
 * provisioned with, and the migration runner and the API boot refuse another.
 */
import { describe, it, expect } from "@jest/globals";

import {
  assertSystemPrincipal,
  SystemPrincipalMismatchError,
} from "../../db/system-principal.util.js";

describe("assertSystemPrincipal (#956)", () => {
  it("passes when the recorded principal matches", async () => {
    await expect(
      assertSystemPrincipal(async () => "SYSTEM", "SYSTEM")
    ).resolves.toBeUndefined();
  });

  it("passes when nothing is recorded yet", async () => {
    await expect(
      assertSystemPrincipal(
        async () => null,
        "5f0c2a7e-0000-4000-8000-000000000000"
      )
    ).resolves.toBeUndefined();
  });

  it("refuses a different principal, naming both", async () => {
    const check = assertSystemPrincipal(async () => "SYSTEM", "OTHER");
    await expect(check).rejects.toBeInstanceOf(SystemPrincipalMismatchError);
    await expect(check).rejects.toThrow(
      /SYSTEM_ID "OTHER" doesn't match the "SYSTEM" this database was provisioned with/
    );
  });
});
