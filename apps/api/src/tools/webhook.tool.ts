/* eslint-disable @typescript-eslint/no-explicit-any */

import { randomUUID } from "crypto";

import { z } from "zod";
import { tool } from "ai";

import type { Consumption, Production } from "@portalai/core/models";

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
import {
  callbackAddressAvailable,
  publicApiBase,
} from "../utils/public-url.util.js";

/** Codes `callWebhook` raises when `guardedFetch` refused the call (#931). */
const OUTBOUND_REFUSAL_CODES: ReadonlySet<unknown> = new Set([
  ApiCode.TOOLPACK_REDIRECT_REFUSED,
  ApiCode.TOOLPACK_URL_PRIVATE_HOST,
  ApiCode.TOOLPACK_SCHEMA_FETCH_FAILED,
]);

/** #931: a refused outbound call as the typed result the agent relays, or
 *  `null` for any other error. */
export function outboundRefusal(
  slug: string,
  err: unknown
): { error: { code: ApiCode; message: string } } | null {
  const code = (err as { code?: unknown } | null)?.code;
  if (!OUTBOUND_REFUSAL_CODES.has(code)) return null;
  const reason = err instanceof Error ? err.message : "The call was refused.";
  return {
    error: {
      code: code as ApiCode,
      message: `The "${slug}" tool couldn't reach its server: ${reason}`,
    },
  };
}

/** The typed result a webhook tool returns when it needs a callback and this
 *  server has no public API address (#891). The agent relays it. */
export function webhookCallbackRefusal(
  slug: string,
  reason: "pull" | "stage"
): { error: { code: ApiCode; message: string } } {
  const why =
    reason === "pull"
      ? `pull its input from this server, and this server's public API address (PUBLIC_API_BASE_URL) isn't set. Pass the data as inline \`rows\` instead of a \`queryHandle\` to run it without a callback.`
      : `stage its result on this server because it's too large to return inline, and this server's public API address (PUBLIC_API_BASE_URL) isn't set.`;
  return {
    error: {
      code: ApiCode.WEBHOOK_CALLBACK_UNCONFIGURED,
      message: `The "${slug}" tool needs to ${why} Other webhook tools still work.`,
    },
  };
}

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
  private production?: Production;
  private userId?: string;

  constructor(
    toolName: string,
    description: string,
    parameterSchema: Record<string, unknown>,
    implementation: WebhookImplementation,
    stationId: string,
    consumption?: Consumption,
    organizationId?: string,
    production?: Production,
    userId?: string
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
    this.production = production;
    this.userId = userId;
  }

  /** #161: a tool gets the output write-grant when it declares it produces
   *  rows that stage to a handle past the inline threshold — driven by
   *  `production` (output), independent of the `consumption` (input) tier. */
  private get wantsOutputGrant(): boolean {
    return (
      this.production?.kind === "rows" && this.production.onLarge === "handle"
    );
  }

  /** A `streaming` call given a `queryHandle`: its runtime must pull the
   *  input back from this server (#891). */
  private pullsHandle(validated: Record<string, unknown>): boolean {
    return (
      this.consumption?.mode === "streaming" &&
      typeof validated.queryHandle === "string" &&
      validated.queryHandle.length > 0
    );
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
          .describe(
            "Inline rows to compute over (alternative to `queryHandle`)."
          ),
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
        // #891: a runtime that must call back (to pull a queryHandle, or to
        // stage a large result) needs this server's public API address. In
        // production without one it's never handed a loopback URL: a pull is
        // refused with the reason, and a large-result tool runs without its
        // write grant. A plain tool never calls back.
        const canCallBack = callbackAddressAvailable();
        if (this.pullsHandle(validated) && !canCallBack) {
          logger.warn(
            {
              toolName: this.slug,
              code: ApiCode.WEBHOOK_CALLBACK_UNCONFIGURED,
            },
            "Webhook tool refused: PUBLIC_API_BASE_URL isn't a public URL"
          );
          return webhookCallbackRefusal(this.slug, "pull");
        }
        // A result small enough to return inline needs no write grant, so a
        // large-result tool still runs without one; only a result too big
        // to return inline then fails, and says why.
        const withholdOutputGrant = this.wantsOutputGrant && !canCallBack;
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
        //  - `streaming` + queryHandle: mint a scoped read token + POST a
        //    pull-on-read `source` grant; the webhook fetches pages itself.
        //  - `streaming` + inline rows: small data runs inline (ceiling, not
        //    mandate) → records-in-body.
        //  - `streaming` also gets an `output` write grant so a large result
        //    can be staged (`produceFromRows`) and returned as `{ resultHandle }`
        //    past the 1 MB inline cap. All grants are revoked when the call
        //    settles (success OR error).
        //  - `none` (default): inline params, today's `{tool, input}`.
        let body: Record<string, unknown>;
        let readToken: string | undefined;
        let writeToken: string | undefined;
        let sessionId: string | undefined;
        try {
          // ── Input tier (consumption): how the dataset reaches the webhook ──
          if (this.consumption?.mode === "streaming") {
            const { queryHandle, rows, ...input } = validated;
            // streaming + queryHandle → a pull-on-read grant; streaming +
            // inline rows (small) → records-in-body (ceiling, not mandate).
            if (typeof queryHandle === "string" && queryHandle.length > 0) {
              const grant = await this.buildPullGrant(queryHandle);
              readToken = grant.readToken;
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
              {
                queryHandle: queryHandle as string | undefined,
                rows: rows as any,
              },
              this.consumption!
            );
            body = { tool: this.slug, input, records: resolved.rows };
          } else {
            body = { tool: this.slug, input: validated };
          }

          // ── Output tier (production, #161): the write-grant is driven by
          // the OUTPUT declaration, not the input mode — so a `none`/`bounded`
          // tool that produces a large row set can stage a handle too.
          if (this.wantsOutputGrant && !withholdOutputGrant) {
            const output = await this.buildOutputGrant();
            sessionId = output.sessionId;
            writeToken = output.writeToken;
            body.output = output.grant;
          }

          let result: unknown;
          try {
            result = await ToolService.callWebhook(this.implementation, body);
          } catch (err) {
            if (
              withholdOutputGrant &&
              (err as { code?: unknown }).code ===
                ApiCode.TOOLPACK_RUNTIME_TOO_LARGE
            ) {
              return webhookCallbackRefusal(this.slug, "stage");
            }
            const refused = outboundRefusal(this.slug, err);
            if (refused) return refused;
            throw err;
          }

          // #124 outbound: a `{ resultHandle }` response opts into the staged
          // handle. Resolve it against what we staged this session (a webhook
          // can't name an arbitrary handle) and return its envelope.
          if (
            sessionId &&
            result &&
            typeof result === "object" &&
            typeof (result as any).resultHandle === "string"
          ) {
            return await this.resolveStagedResult(
              sessionId,
              (result as any).resultHandle
            );
          }

          return result;
        } finally {
          // The grants live only for the duration of this call.
          const cleanup: Array<Promise<unknown>> = [];
          if (readToken)
            cleanup.push(WebhookReadTokenService.revoke(readToken));
          if (writeToken)
            cleanup.push(WebhookReadTokenService.revoke(writeToken));
          if (sessionId)
            cleanup.push(WebhookReadTokenService.clearStagedResult(sessionId));
          await Promise.allSettled(cleanup);
        }
      },
    });
  }

  /** Mint a write grant for a fresh staging session — handed to every
   *  `streaming` webhook so it can stage a large result and return a handle
   *  (used only if it opts in). (#124 outbound) */
  private async buildOutputGrant(): Promise<{
    sessionId: string;
    writeToken: string;
    grant: { writeUrl: string; writeToken: string };
  }> {
    const sessionId = randomUUID();
    const writeToken = await WebhookReadTokenService.mint({
      organizationId: this.organizationId!,
      handleId: sessionId,
      mode: "write",
      stationId: this.stationId,
      // #694: the handle the webhook stages is the invoking user's.
      userId: this.userId,
    });
    return {
      sessionId,
      writeToken,
      grant: {
        writeUrl: `${publicApiBase()}/api/webhook/handle/${sessionId}`,
        writeToken,
      },
    };
  }

  /** Resolve a webhook's claimed `{ resultHandle }` — it must equal the handle
   *  staged under THIS call's session, and belong to the calling org. Returns
   *  the handle envelope (the agent reads it like any query handle). (#124) */
  private async resolveStagedResult(
    sessionId: string,
    claimedHandle: string
  ): Promise<Record<string, unknown>> {
    const staged = await WebhookReadTokenService.getStagedResult(sessionId);
    if (!staged || staged !== claimedHandle) {
      throw new ApiError(
        400,
        ApiCode.WEBHOOK_RESULT_HANDLE_INVALID,
        "Returned resultHandle was not staged by this call"
      );
    }
    const meta = await PortalSqlHandleService.getMeta(staged);
    if (meta._organizationId !== this.organizationId) {
      throw new ApiError(
        403,
        ApiCode.WEBHOOK_HANDLE_SCOPE_MISMATCH,
        "Staged handle belongs to a different organization"
      );
    }
    return {
      queryHandle: staged,
      rowCount: meta.rowCount,
      schema: meta.schema,
      sampled: meta.sampled,
      truncated: meta.truncated,
      samplePeek: meta.samplePeek,
    };
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
      readUrl: `${publicApiBase()}/api/webhook/handle/${handleId}`,
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
