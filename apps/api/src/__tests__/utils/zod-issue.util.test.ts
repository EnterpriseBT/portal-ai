import { describe, it, expect } from "@jest/globals";

import { describeFirstZodIssue } from "../../utils/zod-issue.util.js";

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
