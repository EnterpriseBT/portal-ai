import { createAnthropic } from "@ai-sdk/anthropic";
import { ReadableStream } from "node:stream/web";
import { environment } from "../environment.js";

const anthropic = createAnthropic({
  apiKey: environment.ANTHROPIC_API_KEY,
});

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

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
