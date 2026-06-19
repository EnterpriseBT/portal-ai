/* eslint-disable @typescript-eslint/no-explicit-any */

import { z } from "zod";
import { tool } from "ai";

import type { Consumption } from "@portalai/core/models";

import {
  ToolService,
  type WebhookImplementation,
} from "../services/tools.service.js";
import { Tool } from "../types/tools.js";
import { createLogger } from "../utils/logger.util.js";
import { resolveRecordSource } from "./record-source.js";
import { PortalSqlHandleService } from "../services/portal-sql-handle.service.js";
import { WebhookReadTokenService } from "../services/webhook-read-token.service.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { environment } from "../environment.js";

/** Page size advertised to a `streaming` webhook for its pull-on-read loop —
 *  the `getSnapshot` per-call ceiling. */
const WEBHOOK_PULL_PAGE_LIMIT = 5_000;

const logger = createLogger({ module: "webhook-tool" });

export class WebhookTool extends Tool {
  slug: string;
  name: string;
  description: string;

  private parameterSchema: Record<string, unknown>;
  private implementation: WebhookImplementation;
  private stationId: string;
  private organizationId?: string;
  private consumption?: Consumption;

  constructor(
    toolName: string,
    description: string,
    parameterSchema: Record<string, unknown>,
    implementation: WebhookImplementation,
    stationId: string,
    consumption?: Consumption,
    organizationId?: string
  ) {
    super();
    this.slug = toolName;
    this.name = toolName;
    this.description = description;
    this.parameterSchema = parameterSchema;
    this.implementation = implementation;
    this.stationId = stationId;
    this.consumption = consumption;
    this.organizationId = organizationId;
  }

  /** A `bounded`/`streaming` tool computes over a dataset, so the runtime
   *  injects the compute-source fields (`queryHandle` / `rows`) into its
   *  schema — for `bounded` it resolves them and POSTs `records`; for
   *  `streaming` it hands the webhook a paged pull-on-read grant. (#124) */
  private get needsRecordSource(): boolean {
    return (
      this.consumption?.mode === "bounded" ||
      this.consumption?.mode === "streaming"
    );
  }

  get schema() {
    const base = jsonSchemaToZod(this.parameterSchema);
    if (this.needsRecordSource && base instanceof z.ZodObject) {
      return base.extend({
        queryHandle: z
          .string()
          .optional()
          .describe(
            "A queryHandle from sql_query/display_entity_records whose rows are the dataset this tool computes over. Provide this OR `rows`."
          ),
        rows: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe("Inline rows to compute over (alternative to `queryHandle`)."),
      });
    }
    return base;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema as any,
      execute: async (rawInput: Record<string, unknown>) => {
        const validated = this.validate(rawInput) as Record<string, unknown>;
        logger.info(
          {
            toolName: this.slug,
            stationId: this.stationId,
            url: this.implementation.url,
            consumption: this.consumption?.mode ?? "none",
          },
          "Calling webhook tool"
        );

        // #124: tier the body by the declared consumption.
        //  - `bounded`: resolve the dataset server-side (≤ maxRows, onOverflow
        //    honored) and POST `{tool, input, records}` — rows never enter the
        //    agent's context.
        //  - `streaming` + queryHandle: mint a scoped read token and POST a
        //    pull-on-read `source` grant; the webhook fetches pages itself. The
        //    token is revoked when this call settles (success OR error).
        //  - `streaming` + inline rows: small data runs inline (ceiling, not
        //    mandate) → records-in-body, same as `bounded`.
        //  - `none` (default): inline params, today's `{tool, input}`.
        let body: Record<string, unknown>;
        let mintedToken: string | undefined;
        try {
          if (this.consumption?.mode === "streaming") {
            const { queryHandle, rows, ...input } = validated;
            if (typeof queryHandle === "string" && queryHandle.length > 0) {
              const grant = await this.buildPullGrant(queryHandle);
              mintedToken = grant.readToken;
              body = { tool: this.slug, input, source: grant };
            } else {
              const resolved = await resolveRecordSource(
                { rows: rows as any },
                this.consumption
              );
              body = { tool: this.slug, input, records: resolved.rows };
            }
          } else if (this.needsRecordSource) {
            const { queryHandle, rows, ...input } = validated;
            const resolved = await resolveRecordSource(
              { queryHandle: queryHandle as string | undefined, rows: rows as any },
              this.consumption!
            );
            body = { tool: this.slug, input, records: resolved.rows };
          } else {
            body = { tool: this.slug, input: validated };
          }

          const result = await ToolService.callWebhook(
            this.implementation,
            body
          );

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
        } finally {
          // The grant lives only for the duration of this call.
          if (mintedToken) {
            await WebhookReadTokenService.revoke(mintedToken).catch(() => {
              /* best-effort; the short TTL is the backstop */
            });
          }
        }
      },
    });
  }

  /** Mint a scoped read token for `handleId` and assemble the pull-on-read
   *  grant the `streaming` webhook receives. Refuses a handle the calling org
   *  doesn't own (never mint a token across the org boundary). (#124) */
  private async buildPullGrant(handleId: string): Promise<{
    readUrl: string;
    readToken: string;
    rowCount: number;
    schema: Array<{ name: string; type: string }>;
    pageLimit: number;
  }> {
    if (!this.organizationId) {
      throw new ApiError(
        500,
        ApiCode.WEBHOOK_HANDLE_SCOPE_MISMATCH,
        "Streaming webhook tool built without an organization context"
      );
    }
    const meta = await PortalSqlHandleService.getMeta(handleId);
    if (meta._organizationId !== this.organizationId) {
      throw new ApiError(
        403,
        ApiCode.WEBHOOK_HANDLE_SCOPE_MISMATCH,
        "Query handle belongs to a different organization"
      );
    }
    const readToken = await WebhookReadTokenService.mint({
      organizationId: this.organizationId,
      handleId,
      mode: "read",
    });
    return {
      readUrl: `${environment.PUBLIC_API_BASE_URL}/api/webhook/handle/${handleId}`,
      readToken,
      rowCount: meta.rowCount,
      schema: meta.schema,
      pageLimit: WEBHOOK_PULL_PAGE_LIMIT,
    };
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
      const required = new Set((schema.required as string[] | undefined) ?? []);
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
