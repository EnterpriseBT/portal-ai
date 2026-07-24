import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { resolveSqlDelivery as defaultResolveSqlDelivery } from "./result-sink.js";
import { AiService } from "../services/ai.service.js";
import { validateProgram } from "./visualize-d3.validate.js";
import {
  VISUALIZE_D3_CODEGEN_SYSTEM,
  buildCodegenPrompt,
  type CodegenSchemaColumn,
} from "../prompts/visualize-d3.prompt.js";

// -- Tool input --------------------------------------------------------------
//
// The agent supplies INTENT, not a program: the dedicated codegen sub-call
// (#269) synthesizes the D3 program from the data shape + instruction.

const InputSchema = z.object({
  sql: z.string().describe("SQL query to fetch the visualization data"),
  instruction: z
    .string()
    .min(1)
    .describe(
      "What to visualize: chart type, which result columns map to which encodings, and any emphasis."
    ),
  title: z.string().optional(),
});

/** Total codegen attempts = 1 + MAX_CODEGEN_RETRIES. */
const MAX_CODEGEN_RETRIES = 2;

/** Injectable dependencies (test seam; mirrors the DI style used elsewhere). */
export interface VisualizeD3Deps {
  resolveSqlDelivery?: typeof defaultResolveSqlDelivery;
  generateCode?: typeof AiService.generateCode;
}

interface DerivedShape {
  schema: CodegenSchemaColumn[];
  samplePeek: Array<Record<string, unknown>>;
  /** Inline rows to bind into the block (inline delivery only). */
  rows: Array<Record<string, unknown>> | null;
}

const inferType = (v: unknown): string =>
  v === null || v === undefined
    ? "unknown"
    : typeof v === "number"
      ? "number"
      : typeof v === "boolean"
        ? "boolean"
        : "string";

function deriveShape(
  delivery: Awaited<ReturnType<typeof defaultResolveSqlDelivery>>
): DerivedShape {
  if (delivery.kind === "handle") {
    const env = delivery.envelope;
    return {
      schema: env.schema,
      samplePeek: env.samplePeek ?? [],
      rows: null,
    };
  }
  const result = delivery.result as {
    rows?: Array<Record<string, unknown>>;
    sample?: Array<Record<string, unknown>>;
  };
  const rows = result.rows ?? result.sample ?? [];
  const first = rows[0] ?? {};
  const schema: CodegenSchemaColumn[] = Object.keys(first).map((name) => ({
    name,
    type: inferType((first as Record<string, unknown>)[name]),
  }));
  return { schema, samplePeek: rows.slice(0, 10), rows };
}

export class VisualizeD3Tool extends Tool<typeof InputSchema> {
  slug = "visualize_d3";
  name = "Visualize (D3)";
  description =
    "Render an interactive D3 visualization from a SQL query. Describe the chart you want (type, encodings, emphasis) in `instruction`; the render program is generated for you. Do not add a LIMIT — result size is handled automatically (large results stream to the widget via a handle).";

  get schema() {
    return InputSchema;
  }

  build(stationId: string, organizationId: string, deps: VisualizeD3Deps = {}) {
    const resolveSqlDelivery =
      deps.resolveSqlDelivery ?? defaultResolveSqlDelivery;
    const generateCode =
      deps.generateCode ?? AiService.generateCode.bind(AiService);

    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { sql, instruction, title } = this.validate(input);

        const delivery = await resolveSqlDelivery(
          { sql },
          { stationId, organizationId }
        );
        const { schema, samplePeek, rows } = deriveShape(delivery);
        const titleField = title ? { title } : {};

        let lastError: string | undefined;
        for (let attempt = 0; attempt <= MAX_CODEGEN_RETRIES; attempt++) {
          let program: string;
          try {
            program = await generateCode({
              system: VISUALIZE_D3_CODEGEN_SYSTEM,
              prompt: buildCodegenPrompt({
                instruction,
                schema,
                samplePeek,
                lastError,
              }),
            });
          } catch (err) {
            // Provider/infra error — retrying won't help; relay a typed
            // result the agent surfaces (never throw out of execute).
            return {
              error: {
                code: "VISUALIZE_D3_CODEGEN_FAILED",
                message:
                  err instanceof Error ? err.message : "codegen model error",
              },
            };
          }

          const validation = validateProgram(program);
          if (validation.ok) {
            if (delivery.kind === "handle") {
              return {
                type: "d3",
                program,
                ...titleField,
                ...delivery.envelope,
              };
            }
            return { type: "d3", program, ...titleField, rows: rows ?? [] };
          }
          lastError = validation.error;
        }

        // Codegen couldn't produce a valid program — fall back to the data
        // as a table so the query result is still delivered.
        const message =
          "Couldn't generate the visualization; showing the query result as a table.";
        if (delivery.kind === "handle") {
          return { type: "data-table", ...delivery.envelope, message };
        }
        return { type: "data-table", rows: rows ?? [], message };
      },
    });
  }
}
