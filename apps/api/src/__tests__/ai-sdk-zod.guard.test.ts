/**
 * The AI SDK validates tool input with our zod, not a copy of its own (#846).
 *
 * `@ai-sdk/provider-utils` checks a model's tool call against the tool's
 * `inputSchema` before `execute` runs, with whichever `zod` resolves beside
 * it; zod is only its peer. When that was a hoisted 3.25.76 while our schemas
 * were built on 4.6.x, a failed `.refine` left the schema object on the issue:
 * the agent got a schema dump instead of the reason, and with the recursive
 * FilterExpressionSchema inside, reading the error's message threw
 * "Converting circular structure to JSON". The root `package.json` pins zod 4
 * at the top of `node_modules` so both sides share one copy; this fails CI if
 * a lockfile change ever splits them again.
 */
import { createRequire } from "node:module";

import { describe, it, expect } from "@jest/globals";
import { asSchema } from "ai";
import { z } from "zod";

import { FilterExpressionSchema } from "@portalai/core/contracts";

const requireHere = createRequire(import.meta.url);

/** The SDK's error for an input the schema refuses. */
const sdkError = async (schema: z.ZodType, input: unknown) => {
  const result = await asSchema(schema).validate!(input);
  expect(result.success).toBe(false);
  return (result as { error: Error & { cause?: unknown } }).error;
};

/** The zod issues the SDK attached, whatever wrapper carries them. */
const issuesOf = (error: Error & { cause?: unknown }): object[] => {
  const zodError = (error.cause ?? error) as { issues?: object[] };
  return zodError.issues ?? [];
};

describe("the AI SDK and the API share one zod (#846)", () => {
  // provider-utils is checked as each SDK entry point loads it, not only the
  // hoisted copy: a version skew could nest a second provider-utils (with its
  // own zod) under `ai` or the Anthropic provider.
  it.each(["ai", "@ai-sdk/anthropic"])(
    "resolves the same zod module through %s as the API does",
    (entry) => {
      const fromEntry = createRequire(requireHere.resolve(entry));
      const providerUtils = fromEntry.resolve("@ai-sdk/provider-utils");
      const zodFromSdk = createRequire(providerUtils).resolve("zod");
      expect(zodFromSdk).toBe(requireHere.resolve("zod"));
    }
  );

  it("reports a refine refusal as { code, path, message }, with no schema on it", async () => {
    const schema = z
      .object({ key: z.string() })
      .refine((v) => !v.key.startsWith("c_"), {
        message: "key must not start with c_",
      });
    const error = await sdkError(schema, { key: "c_total" });

    // Guards the loop below: a wrapper that hid the issues would pass it.
    const issues = issuesOf(error);
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(Object.keys(issue)).not.toContain("schema");
    }
    expect(error.message).toContain("key must not start with c_");
    // The reason, not a serialized schema.
    expect(error.message.length).toBeLessThan(300);
  });

  it("prints a refusal from a schema holding the recursive filter", async () => {
    const schema = z
      .object({
        filter: FilterExpressionSchema.optional(),
        filterSql: z.string().optional(),
      })
      .refine((v) => !(v.filter && v.filterSql), {
        message: "set filter or filterSql, not both",
      });
    const error = await sdkError(schema, {
      filter: {
        combinator: "and",
        conditions: [{ field: "amount", operator: "gt", value: 10 }],
      },
      filterSql: "amount > 10",
    });

    // Before #846 this read threw "Converting circular structure to JSON".
    expect(() => error.message).not.toThrow();
    expect(error.message).toContain("set filter or filterSql, not both");
  });
});
