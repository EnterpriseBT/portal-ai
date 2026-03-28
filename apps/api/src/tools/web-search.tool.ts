import { z } from "zod";
import { tool } from "ai";
import { tavily } from "@tavily/core";

import { environment } from "../environment.js";
import { Tool } from "../types/tools.js";

const InputSchema = z.object({ query: z.string() });

export class WebSearchTool extends Tool<typeof InputSchema> {
  slug = "web_search";
  name = "Web Search";
  description =
    "Search the web for current information. Use this when the prompt requires real-time or recent data.";

  get schema() {
    return InputSchema;
  }

  build() {
    if (!environment.TAVILY_API_KEY) throw new Error("Tavily API key not configured");
    const client = tavily({ apiKey: environment.TAVILY_API_KEY });

    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { query } = this.validate(input);
        const response = await client.search(query, {
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
