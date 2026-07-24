import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText as defaultGenerateText } from "ai";
import { ReadableStream } from "node:stream/web";
import { environment } from "../environment.js";

const anthropic = createAnthropic({
  apiKey: environment.ANTHROPIC_API_KEY,
});

// claude-sonnet-4-6 is the current Sonnet. The prior pin,
// claude-sonnet-4-20250514 (Sonnet 4), retired 2026-06-15 and now
// errors at the provider. Drop-in same-tier replacement.
const DEFAULT_MODEL = "claude-sonnet-4-6";

// claude-opus-4-8 is the codegen tier for correctness-sensitive synthesis
// subtasks (e.g. visualize_d3's D3-program generation, #269) — distinct from
// the conversational DEFAULT_MODEL.
const CODEGEN_MODEL = "claude-opus-4-8";

export interface AiStreamResult {
  textStream: AsyncIterable<string> & ReadableStream<string>;
}

/** Reasoning-depth levels this codebase passes to the Anthropic provider.
 *  NOTE: the pinned `@ai-sdk/anthropic` (3.0.58) enum accepts only
 *  low|medium|high|max — `xhigh` exists at the API but not this SDK version,
 *  so it is deferred to a v4 upgrade (see docs/VISUALIZE_D3_TOOL.spec.md). */
export type CodegenEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Test seam mirroring spreadsheet-parsing-llm.service — the AI SDK's
 *  `generateText`, narrowed to what `generateCode` needs. */
type GenerateTextFn = (args: {
  model: ReturnType<typeof anthropic>;
  system: string;
  prompt: string;
  providerOptions: { anthropic: Record<string, unknown> };
}) => Promise<{ text: string }>;

export class AiService {
  static get DEFAULT_MODEL() {
    return DEFAULT_MODEL;
  }

  static get CODEGEN_MODEL() {
    return CODEGEN_MODEL;
  }

  static get providers() {
    return {
      anthropic,
    };
  }

  /**
   * A focused single-shot text generation at a task-specific model + effort —
   * distinct from the conversational agent loop (DEFAULT_MODEL). Reusable by
   * any tool needing "the best model for a codegen/synthesis subtask" (#269).
   * Returns the model's raw text (e.g. a D3 program body). Not streamed — the
   * call is internal to one tool `execute`.
   */
  static async generateCode(params: {
    system: string;
    prompt: string;
    model?: string;
    effort?: CodegenEffort;
    /** Injected for tests; defaults to the AI SDK `generateText`. */
    generateText?: GenerateTextFn;
  }): Promise<string> {
    const gen = params.generateText ?? (defaultGenerateText as GenerateTextFn);
    const { text } = await gen({
      model: anthropic(params.model ?? CODEGEN_MODEL),
      system: params.system,
      prompt: params.prompt,
      providerOptions: {
        anthropic: {
          thinking: { type: "adaptive" },
          effort: params.effort ?? "high",
        },
      },
    });
    return text;
  }
}
