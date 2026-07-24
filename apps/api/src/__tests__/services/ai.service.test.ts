import { describe, it, expect, jest } from "@jest/globals";

import { AiService } from "../../services/ai.service.js";

// The codegen seam (#269) is DI-testable: `generateCode` accepts an injected
// `generateText` fn (mirrors spreadsheet-parsing-llm.service's test seam), so
// no module mock is needed — we capture the call args and return a fake text.

type GenArgs = {
  model: unknown;
  system?: string;
  prompt?: string;
  providerOptions?: { anthropic?: { effort?: string } };
};

const fakeGen = (text: string) => {
  const calls: GenArgs[] = [];
  const fn = jest.fn(async (args: GenArgs) => {
    calls.push(args);
    return { text } as { text: string };
  });
  return { fn, calls };
};

describe("AiService.generateCode (#269 codegen seam)", () => {
  it("calls the generate fn with the default model + default effort 'high', returns the text", async () => {
    const { fn, calls } = fakeGen("api.d3.select(api.container);");

    const out = await AiService.generateCode({
      system: "sys",
      prompt: "make a bar chart",
      generateText: fn as never,
    });

    expect(out).toBe("api.d3.select(api.container);");
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe("sys");
    expect(calls[0].prompt).toBe("make a bar chart");
    // Effort reaches the Anthropic provider options at the pinned-SDK ceiling.
    expect(calls[0].providerOptions?.anthropic?.effort).toBe("high");
    // Model is the codegen model, resolved through the anthropic provider.
    expect(calls[0].model).toBeDefined();
  });

  it("honors an explicit model + effort override", async () => {
    const { fn, calls } = fakeGen("prog");
    await AiService.generateCode({
      model: "claude-sonnet-5",
      effort: "medium",
      system: "s",
      prompt: "p",
      generateText: fn as never,
    });
    expect(calls[0].providerOptions?.anthropic?.effort).toBe("medium");
  });

  it("exposes CODEGEN_MODEL as the opus codegen tier", () => {
    expect(AiService.CODEGEN_MODEL).toBe("claude-opus-4-8");
  });
});
