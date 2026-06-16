import { createAnthropic } from "@ai-sdk/anthropic";
import { ReadableStream } from "node:stream/web";
import { environment } from "../environment.js";

const anthropic = createAnthropic({
  apiKey: environment.ANTHROPIC_API_KEY,
});

// claude-sonnet-4-6 is the current Sonnet. The prior pin,
// claude-sonnet-4-20250514 (Sonnet 4), retired 2026-06-15 and now
// errors at the provider. Drop-in same-tier replacement.
const DEFAULT_MODEL = "claude-sonnet-4-6";

export interface AiStreamResult {
  textStream: AsyncIterable<string> & ReadableStream<string>;
}

export class AiService {
  static get DEFAULT_MODEL() {
    return DEFAULT_MODEL;
  }

  static get providers() {
    return {
      anthropic,
    };
  }
}
