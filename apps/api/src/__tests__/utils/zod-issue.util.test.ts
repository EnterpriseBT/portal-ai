import { describe, it, expect } from "@jest/globals";

import { z } from "zod";

import {
  describeFirstZodIssue,
  invalidPayload,
  MAX_ECHOED_ISSUES,
  MAX_ECHOED_KEYS,
  MAX_ECHOED_KEY_LENGTH,
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

describe("invalidPayload bounds what it echoes (#745 adversarial)", () => {
  const fail = (schema: z.ZodType, body: unknown) => {
    const parsed = schema.safeParse(body);
    if (parsed.success) throw new Error("expected a failure");
    return invalidPayload(
      ApiCode.PORTAL_INVALID_PAYLOAD,
      "Invalid x payload",
      parsed.error
    );
  };
  type Details = {
    issues: Array<{ code: string; keys?: string[]; message: string }>;
    issueCount: number;
  };

  it("caps details.issues and reports the true count", () => {
    const err = fail(z.object({ files: z.array(z.object({})) }).strict(), {
      files: Array.from({ length: 5000 }, () => 0),
    });
    const details = err.details as Details;
    expect(details.issues).toHaveLength(MAX_ECHOED_ISSUES);
    expect(details.issueCount).toBe(5000);
    expect(err.message).toMatch(/^Invalid x payload: files\.0: /);
  });

  it("keeps every issue and the count when under the cap", () => {
    const err = fail(z.object({ a: z.string(), b: z.string() }).strict(), {});
    const details = err.details as Details;
    expect(details.issues).toHaveLength(2);
    expect(details.issueCount).toBe(2);
  });

  it("caps an unrecognized-keys list and says how many more there were", () => {
    const body: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) body[`k${i}`] = 1;
    const err = fail(z.object({}).strict(), body);
    const [issue] = (err.details as Details).issues;
    expect(issue.keys).toHaveLength(MAX_ECHOED_KEYS);
    expect(issue.keys?.[0]).toBe("k0");
    expect(issue.message).toMatch(
      /^Unrecognized keys: "k0", .* and 4980 more$/
    );
    expect(err.message).toBe(`Invalid x payload: ${issue.message}`);
    expect(err.message.length).toBeLessThan(400);
  });

  it("clips an oversized key name", () => {
    const longKey = "x".repeat(100_000);
    const err = fail(z.object({}).strict(), { [longKey]: 1 });
    const [issue] = (err.details as Details).issues;
    expect(issue.keys?.[0].length).toBeLessThanOrEqual(
      MAX_ECHOED_KEY_LENGTH + 1
    );
    expect(err.message.length).toBeLessThan(200);
  });

  it("leaves a short unrecognized-keys issue as Zod wrote it", () => {
    const err = fail(z.object({}).strict(), { stationID: 1 });
    expect(err.message).toBe(
      'Invalid x payload: Unrecognized key: "stationID"'
    );
    expect((err.details as Details).issues[0].keys).toEqual(["stationID"]);
  });
});
