/**
 * #1102: the `prepareStep` reminder reaches the model, pinned against the
 * real `streamText`. portal.service.test.ts mocks `ai`, so it can check what
 * `narrationStepPrep` returns but not that the SDK sends it: this file runs
 * the SDK and reads the system prompt each model call received.
 */
import { describe, it, expect } from "@jest/globals";
import { simulateReadableStream, stepCountIs, streamText, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

import {
  narrationStepPrep,
  NEXT_TOOL_REMINDER,
  renderedBlockReminder,
} from "../../services/portal.service.js";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** Step 1 calls `toolName`; step 2 answers in text. Records each call's system. */
function scriptedModel(toolName: string, systems: string[]) {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async (options: {
      prompt: Array<{ role: string; content: unknown }>;
    }) => {
      systems.push(
        options.prompt
          .filter((m) => m.role === "system")
          .map((m) => String(m.content))
          .join("\n")
      );
      call++;
      const chunks =
        call === 1
          ? [
              { type: "stream-start", warnings: [] },
              { type: "tool-call", toolCallId: "c1", toolName, input: "{}" },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_use" },
                usage,
              },
            ]
          : [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "t" },
              { type: "text-delta", id: "t", delta: "Done." },
              { type: "text-end", id: "t" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: "end_turn" },
                usage,
              },
            ];
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
    },
  } as never);
}

async function systemsFor(toolName: string, output: unknown) {
  const systems: string[] = [];
  const result = streamText({
    model: scriptedModel(toolName, systems),
    system: "base prompt",
    prompt: "go",
    tools: {
      [toolName]: tool({
        description: "test tool",
        inputSchema: z.object({}),
        execute: async () => output,
      }),
    },
    stopWhen: stepCountIs(5),
    prepareStep: narrationStepPrep("base prompt"),
  });
  for await (const part of result.fullStream) void part;
  return systems;
}

describe("narrationStepPrep through streamText (#1102)", () => {
  it("adds the reminder to the call after a rendered block, not before", async () => {
    const systems = await systemsFor("sql_query", { rows: [{ id: 1 }] });
    expect(systems).toHaveLength(2);
    expect(systems[0]).not.toContain("already on screen");
    expect(systems[0]).not.toContain(NEXT_TOOL_REMINDER);
    expect(systems[1]).toContain(renderedBlockReminder(["sql_query"], false));
    expect(systems[1]).toContain(NEXT_TOOL_REMINDER);
    expect(systems[1]).toContain("base prompt");
  });

  it("gives the call after a scalar result only the next-tool reminder", async () => {
    const systems = await systemsFor("cluster", { clusters: [] });
    expect(systems).toHaveLength(2);
    expect(systems[1]).not.toContain("already on screen");
    expect(systems[1]).toContain(NEXT_TOOL_REMINDER);
  });
});
