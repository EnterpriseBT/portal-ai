import { describe, it, expect } from "@jest/globals";

import { z } from "zod";

import {
  describeFirstZodIssue,
  invalidPayload,
} from "../../utils/zod-issue.util.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

describe("describeFirstZodIssue (#706)", () => {
  it("prefixes the issue with its dotted path", () => {
    expect(
      describeFirstZodIssue([
        { path: ["tools", 0, "name"], message: "Required" },
        { path: ["other"], message: "ignored" },
      ])
    ).toBe("tools.0.name: Required");
  });

  it("gives a root-level issue without a path prefix", () => {
    expect(
      describeFirstZodIssue([
        { path: [], message: "At least one field must be provided" },
      ])
    ).toBe("At least one field must be provided");
  });

  it("falls back when there are no issues", () => {
    expect(describeFirstZodIssue([])).toBe("validation failed");
    expect(describeFirstZodIssue([], "invalid body")).toBe("invalid body");
  });
});

describe("invalidPayload (#742)", () => {
  it("builds a 400 with the domain code, the first issue and all issues", () => {
    const parsed = z
      .object({ name: z.string(), n: z.number() })
      .strict()
      .safeParse({ name: 1, n: "x" });
    if (parsed.success) throw new Error("expected a failure");
    const err = invalidPayload(
      ApiCode.PORTAL_INVALID_PAYLOAD,
      "Invalid portal payload",
      parsed.error
    );
    expect(err.status).toBe(400);
    expect(err.code).toBe(ApiCode.PORTAL_INVALID_PAYLOAD);
    expect(err.message).toMatch(/^Invalid portal payload: name: /);
    expect((err.details as { issues: unknown[] }).issues).toHaveLength(2);
  });
});
