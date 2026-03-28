/* eslint-disable @typescript-eslint/no-explicit-any */

import { z } from "zod";
import { tool } from "ai";

import { ToolService, type WebhookImplementation } from "../services/tools.service.js";
import { Tool } from "../types/tools.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "webhook-tool" });

export class WebhookTool extends Tool {
  slug: string;
  name: string;
  description: string;

  private parameterSchema: Record<string, unknown>;
  private implementation: WebhookImplementation;
  private stationId: string;

  constructor(
    toolName: string,
    description: string,
    parameterSchema: Record<string, unknown>,
    implementation: WebhookImplementation,
    stationId: string,
  ) {
    super();
    this.slug = toolName;
    this.name = toolName;
    this.description = description;
    this.parameterSchema = parameterSchema;
    this.implementation = implementation;
    this.stationId = stationId;
  }

  get schema() {
    return jsonSchemaToZod(this.parameterSchema);
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema as any,
      execute: async (rawInput: Record<string, unknown>) => {
        const input = this.validate(rawInput) as Record<string, unknown>;
        logger.info(
          { toolName: this.slug, stationId: this.stationId, url: this.implementation.url },
          "Calling webhook tool"
        );
        const result = await ToolService.callWebhook(this.implementation, input);

        // Propagate vega-lite and vega chart results
        if (
          result &&
          typeof result === "object" &&
          (result as any).type === "vega-lite" &&
          (result as any).spec
        ) {
          return { type: "vega-lite", spec: (result as any).spec };
        }
        if (
          result &&
          typeof result === "object" &&
          (result as any).type === "vega"
        ) {
          return result;
        }

        return result;
      },
    });
  }
}

/**
 * Convert a JSON Schema object to a Zod schema at runtime.
 * Supports the subset of JSON Schema commonly used by webhook tool definitions.
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  const type = schema.type as string | undefined;

  switch (type) {
    case "string":
      return z.string();
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(
        schema.items
          ? jsonSchemaToZod(schema.items as Record<string, unknown>)
          : z.unknown()
      );
    case "object": {
      const properties = (schema.properties ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const required = new Set(
        (schema.required as string[] | undefined) ?? []
      );
      const shape: Record<string, z.ZodType> = {};

      for (const [key, propSchema] of Object.entries(properties)) {
        const zodProp = jsonSchemaToZod(propSchema);
        shape[key] = required.has(key) ? zodProp : zodProp.optional();
      }

      return z.object(shape);
    }
    default:
      return z.unknown();
  }
}
