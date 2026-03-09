import { createAnthropic } from "@ai-sdk/anthropic";
import { ReadableStream } from "node:stream/web";
import { tool } from "ai";
import { tavily } from "@tavily/core";
import { z } from "zod";
import { environment } from "../environment.js";

const anthropic = createAnthropic({
  apiKey: environment.ANTHROPIC_API_KEY,
});

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export interface AiStreamResult {
  textStream: AsyncIterable<string> & ReadableStream<string>;
}

export enum ToolName {
  WebSearch = "webSearch",
}

export class AiService {

  static get DEFAULT_MODEL() {
    return DEFAULT_MODEL;
  }

  static get providers() {
    return {
      anthropic
    }
  }

  static get tools() {
    return {
      [ToolName.WebSearch]: this.buildWebSearchTool(),
    }
  }

  static buildWebSearchTool() {
    if (!environment.TAVILY_API_KEY) throw new Error("Tavily API key not configured");
    const client = tavily({ apiKey: environment.TAVILY_API_KEY });

    return tool({
      description:
        "Search the web for current information. Use this when the prompt requires real-time or recent data.",
      inputSchema: z.object({ query: z.string() }),
      execute: async (input) => {
        const response = await client.search(input.query, {
          maxResults: 5,
          includeAnswer: true,
        });
        return {
          answer: response.answer,
          results: response.results.map((r: { title: string; url: string; content: string }) => ({
            title: r.title,
            url: r.url,
            content: r.content,
          })),
        };
      },
    });
  }
}
