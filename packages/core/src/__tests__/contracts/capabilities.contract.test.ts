import { describe, it, expect } from "@jest/globals";
import { z } from "zod";

import {
  ObjectCapabilitiesSchema,
  withCapabilities,
  withShareableCapabilities,
} from "../../contracts/capabilities.contract";

/** #688: the per-object capabilities a payload row carries. */
describe("capabilities contract (#688)", () => {
  const Row = z.object({ id: z.string() });

  it("ObjectCapabilities requires read, write and delete", () => {
    expect(
      ObjectCapabilitiesSchema.safeParse({
        read: true,
        write: false,
        delete: false,
      }).success
    ).toBe(true);
    expect(
      ObjectCapabilitiesSchema.safeParse({ read: true, write: false }).success
    ).toBe(false);
  });

  it("withCapabilities adds a required capabilities field to a row", () => {
    const S = withCapabilities(Row);
    expect(
      S.safeParse({
        id: "a",
        capabilities: { read: true, write: true, delete: true },
      }).success
    ).toBe(true);
    expect(S.safeParse({ id: "a" }).success).toBe(false);
  });

  it("withShareableCapabilities also requires share", () => {
    const S = withShareableCapabilities(Row);
    expect(
      S.safeParse({
        id: "a",
        capabilities: { read: true, write: true, delete: true, share: false },
      }).success
    ).toBe(true);
    expect(
      S.safeParse({
        id: "a",
        capabilities: { read: true, write: true, delete: true },
      }).success
    ).toBe(false);
  });
});
