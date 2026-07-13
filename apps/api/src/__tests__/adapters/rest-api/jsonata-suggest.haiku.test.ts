import { jest, describe, it, expect } from "@jest/globals";

import { createDefaultJsonataSuggester } from "../../../adapters/rest-api/jsonata-suggest.haiku.js";
import { JsonataSuggestError } from "../../../adapters/rest-api/jsonata-suggest.types.js";

function makeOkResponse(expression: string) {
  return {
    object: { expression },
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

// ── Happy path ───────────────────────────────────────────────────────

describe("createDefaultJsonataSuggester — happy path", () => {
  it("returns the expression from the model response", async () => {
    const gen = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(makeOkResponse("data.items"));
    const suggester = createDefaultJsonataSuggester({
      generateObject: gen as never,
    });

    const result = await suggester.suggest({
      sampleResponse: { data: { items: [{ id: 1 }] } },
    });

    expect(gen).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ expression: "data.items" });
  });

  it("threads the hint through the prompt argument to generateObject", async () => {
    const gen = jest
      .fn<(args: { prompt: string }) => Promise<unknown>>()
      .mockResolvedValueOnce(makeOkResponse("data.items"));
    const suggester = createDefaultJsonataSuggester({
      generateObject: gen as never,
    });

    await suggester.suggest({
      sampleResponse: { data: { items: [] } },
      promptHint: "use just id and email",
    });

    const callArg = gen.mock.calls[0]![0];
    expect(callArg.prompt).toContain("use just id and email");
    expect(callArg.prompt).not.toContain("(no hint provided)");
  });

  it("threads the previousAttempt through the prompt argument", async () => {
    const gen = jest
      .fn<(args: { prompt: string }) => Promise<unknown>>()
      .mockResolvedValueOnce(makeOkResponse("data.items.{ id }"));
    const suggester = createDefaultJsonataSuggester({
      generateObject: gen as never,
    });

    await suggester.suggest({
      sampleResponse: { data: { items: [] } },
      previousAttempt: {
        expression: "data.items.{}",
        error: "the expression returned 0 records",
      },
    });

    const callArg = gen.mock.calls[0]![0];
    expect(callArg.prompt).toContain("## Previous attempt");
    expect(callArg.prompt).toContain("data.items.{}");
    expect(callArg.prompt).toContain("the expression returned 0 records");
  });

  it("does NOT re-truncate the sample (route owns truncation)", async () => {
    const gen = jest
      .fn<(args: { prompt: string }) => Promise<unknown>>()
      .mockResolvedValueOnce(makeOkResponse("data"));
    const suggester = createDefaultJsonataSuggester({
      generateObject: gen as never,
    });

    // Pass a 10-element array straight through; the suggester should
    // render it verbatim, not slice it. (The route is responsible for
    // running truncateForPrompt before invoking the suggester.)
    const tenElems = Array.from({ length: 10 }, (_, i) => i);
    await suggester.suggest({ sampleResponse: { data: tenElems } });

    const prompt = gen.mock.calls[0]![0].prompt;
    expect(prompt).toContain(JSON.stringify({ data: tenElems }, null, 2));
    expect(prompt).not.toContain("__truncated__");
  });

  it("uses the default Haiku model id when no override is supplied", async () => {
    const modelFn = jest.fn<(id: string) => unknown>().mockReturnValue("MODEL");
    const gen = jest
      .fn<(args: { model: unknown }) => Promise<unknown>>()
      .mockResolvedValueOnce(makeOkResponse("data"));
    const suggester = createDefaultJsonataSuggester({
      generateObject: gen as never,
      // anthropic provider override — bypass the real AiService wiring.
      anthropic: modelFn as never,
    });

    await suggester.suggest({ sampleResponse: {} });

    expect(modelFn).toHaveBeenCalledWith("claude-haiku-4-5-20251001");
    expect(gen.mock.calls[0]![0].model).toBe("MODEL");
  });

  it("uses the override model id when supplied", async () => {
    const modelFn = jest.fn<(id: string) => unknown>().mockReturnValue("MODEL");
    const gen = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(makeOkResponse("data"));
    const suggester = createDefaultJsonataSuggester({
      model: "claude-opus-4-7",
      generateObject: gen as never,
      anthropic: modelFn as never,
    });

    await suggester.suggest({ sampleResponse: {} });

    expect(modelFn).toHaveBeenCalledWith("claude-opus-4-7");
  });
});

// ── Error paths ──────────────────────────────────────────────────────

describe("createDefaultJsonataSuggester — error paths", () => {
  it("throws JsonataSuggestError('malformed-response') when the model response fails schema validation", async () => {
    const gen = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({ object: { unexpected: "shape" } });
    const suggester = createDefaultJsonataSuggester({
      generateObject: gen as never,
    });

    await expect(
      suggester.suggest({ sampleResponse: {} })
    ).rejects.toMatchObject({
      name: "JsonataSuggestError",
      reason: "malformed-response",
    });
  });

  it("throws JsonataSuggestError('malformed-response') when the expression is empty string", async () => {
    const gen = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({ object: { expression: "" } });
    const suggester = createDefaultJsonataSuggester({
      generateObject: gen as never,
    });

    await expect(
      suggester.suggest({ sampleResponse: {} })
    ).rejects.toMatchObject({
      name: "JsonataSuggestError",
      reason: "malformed-response",
    });
  });

  it("wraps AbortError as JsonataSuggestError('timeout')", async () => {
    const abortErr = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    const gen = jest
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(abortErr);
    const suggester = createDefaultJsonataSuggester({
      generateObject: gen as never,
    });

    await expect(
      suggester.suggest({ sampleResponse: {} })
    ).rejects.toMatchObject({
      name: "JsonataSuggestError",
      reason: "timeout",
    });
  });

  it("wraps a generic throw as JsonataSuggestError('network-error')", async () => {
    const gen = jest
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const suggester = createDefaultJsonataSuggester({
      generateObject: gen as never,
    });

    await expect(
      suggester.suggest({ sampleResponse: {} })
    ).rejects.toMatchObject({
      name: "JsonataSuggestError",
      reason: "network-error",
    });
  });

  it("preserves the underlying error message via the wrapped message + .cause", async () => {
    const underlying = new Error("upstream rejected");
    const gen = jest
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(underlying);
    const suggester = createDefaultJsonataSuggester({
      generateObject: gen as never,
    });

    try {
      await suggester.suggest({ sampleResponse: {} });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(JsonataSuggestError);
      expect((err as JsonataSuggestError).message).toContain(
        "upstream rejected"
      );
      expect((err as JsonataSuggestError).cause).toBe(underlying);
    }
  });
});
