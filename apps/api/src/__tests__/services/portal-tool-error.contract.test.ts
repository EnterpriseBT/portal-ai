/**
 * The AI SDK's stream shape for a refused tool input (#846), pinned against
 * the real `streamText`.
 *
 * `PortalService.streamResponse`'s `handleToolError` classifies a refusal by
 * the `invalid` flag and error object on the call's `tool-call` part, because
 * the `tool-error` that follows carries only a message string. The first
 * version read the error off `tool-error` and stored every refusal as
 * TOOL_EXECUTION_FAILED; its unit test faked a shape the SDK never sends
 * (found in the #846 smoke walk). portal.service.test.ts mocks `ai`, so this
 * file runs the SDK itself: if an upgrade moves the error, it fails here.
 */
import { describe, it, expect } from "@jest/globals";
import { simulateReadableStream, streamText, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** A model whose one step calls `create_thing` with `input`. */
const modelCalling = (input: unknown) =>
  new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "create_thing",
            input: JSON.stringify(input),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_use" },
            usage,
          },
        ],
      }),
    }),
  } as never);

const tools = {
  create_thing: tool({
    description: "test tool",
    inputSchema: z
      .object({
        filter: z.string().optional(),
        filterSql: z.string().optional(),
      })
      .refine((v) => !(v.filter && v.filterSql), {
        message: "Set filter or filterSql, not both",
      }),
    execute: async () => ({ ok: true }),
  }),
};

const partsFor = async (input: unknown) => {
  const result = streamText({
    model: modelCalling(input),
    tools,
    prompt: "go",
  });
  const parts: Record<string, unknown>[] = [];
  for await (const part of result.fullStream) {
    parts.push(part as Record<string, unknown>);
  }
  return parts;
};

describe("AI SDK refused-input stream shape (#846)", () => {
  it("flags the tool-call part invalid and puts the error object there", async () => {
    const parts = await partsFor({ filter: "a", filterSql: "b" });
    const call = parts.find((p) => p.type === "tool-call");

    expect(call).toMatchObject({ toolCallId: "call-1", invalid: true });
    // The zod issues sit down the error's cause chain, which is what
    // handleToolError's issueMessages walks.
    let e: unknown = call?.error;
    let issues: { message: string }[] | undefined;
    for (let depth = 0; e && depth < 5 && !issues; depth++) {
      issues = (e as { issues?: { message: string }[] }).issues;
      e = (e as { cause?: unknown }).cause;
    }
    expect(issues?.map((i) => i.message)).toContain(
      "Set filter or filterSql, not both"
    );
  });

  it("follows it with a tool-error whose error is only a message string", async () => {
    const parts = await partsFor({ filter: "a", filterSql: "b" });
    const toolError = parts.find((p) => p.type === "tool-error");

    expect(toolError).toMatchObject({ toolCallId: "call-1" });
    expect(typeof toolError?.error).toBe("string");
  });

  it("does not flag a valid call", async () => {
    const parts = await partsFor({ filter: "a" });
    const call = parts.find((p) => p.type === "tool-call");

    expect(call?.invalid).toBeFalsy();
    expect(parts.some((p) => p.type === "tool-result")).toBe(true);
  });
});
