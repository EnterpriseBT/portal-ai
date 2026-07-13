import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";
import { ToolCapabilitySchema } from "./tool-capability.model.js";

/**
 * Organization Toolpack model — the canonical record for a custom
 * toolpack registered by an organization via the three-endpoint
 * webhook contract (schema + runtime + optional metadata).
 *
 * The cached `tools` array mirrors the response of the schema
 * endpoint at the most recent fetch (`schemaFetchedAt`). The cached
 * `metadata` mirrors the metadata endpoint at the most recent
 * successful fetch; it stays `null` if the endpoint was never
 * supplied or every fetch failed (failures are non-fatal).
 *
 * Sync with the Drizzle `organization_toolpacks` table is enforced
 * at compile time via `apps/api/src/db/schema/type-checks.ts` and
 * at runtime via drizzle-zod derived schemas in
 * `apps/api/src/db/schema/zod.ts`.
 */

// ── Slug regex ──────────────────────────────────────────────────────
//
// Used for both pack names and tool names. Matches snake_case-style
// identifiers up to 63 chars, leading lowercase letter required.
export const TOOLPACK_SLUG_REGEX = /^[a-z][a-z0-9_]{0,62}$/;

// ── Endpoint shape ──────────────────────────────────────────────────

import { validateToolpackUrl } from "../utils/toolpack-url-safety.util.js";

const ToolpackUrlSchema = z
  .string()
  .url()
  .superRefine((url, ctx) => {
    const err = validateToolpackUrl(url);
    if (err) {
      ctx.addIssue({
        code: "custom",
        message: err.message,
        params: { code: err.code },
      });
    }
  });

export const ToolpackEndpointsSchema = z.object({
  schema: ToolpackUrlSchema,
  runtime: ToolpackUrlSchema,
  metadata: ToolpackUrlSchema.optional(),
});
export type ToolpackEndpoints = z.infer<typeof ToolpackEndpointsSchema>;

// ── Bulk-dispatch metadata ──────────────────────────────────────────
//
// Opt-in metadata that allows a tool to be dispatched per-record by
// the bulk-transform processor (#85 Phase 4). When the schema
// endpoint declares this on a tool, the tool becomes eligible for
// `transform_entity_records` with `expression.kind === "tool"`;
// the dispatcher uses these values to fan out within bounded
// concurrency / rate / timeout.

export const BulkDispatchMetadataSchema = z.object({
  maxConcurrency: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  ratePerSec: z.number().positive().optional(),
  idempotent: z.boolean(),
  estimatedMsPerCall: z.number().positive().optional(),
  costHint: z.enum(["free", "metered", "expensive"]).optional(),
});
export type BulkDispatchMetadata = z.infer<typeof BulkDispatchMetadataSchema>;

// ── Tool definition ─────────────────────────────────────────────────

export const ToolpackToolDefinitionSchema = z.object({
  name: z.string().regex(TOOLPACK_SLUG_REGEX),
  description: z.string().min(1),
  parameterSchema: z.record(z.string(), z.unknown()),
  /** Optional bulk-dispatch eligibility — webhook schemas can declare
   *  this so the tool becomes available to `transform_entity_records`
   *  with `expression.kind === "tool"`. Absent means the tool is rejected
   *  from the dispatch path (matches the existing builtin contract). */
  bulkDispatch: BulkDispatchMetadataSchema.optional(),
  /** Optional declared capability (#121). Custom tools may declare only the
   *  pure-consumer subset — enforced at registration via
   *  `customToolCapabilityError`. Absent means a legacy pure inline tool. */
  capability: ToolCapabilitySchema.optional(),
});
export type ToolpackToolDefinition = z.infer<
  typeof ToolpackToolDefinitionSchema
>;

// ── Metadata endpoint shape ─────────────────────────────────────────

export const ToolpackMetadataExampleSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
});

export const ToolpackMetadataToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  examples: z.array(ToolpackMetadataExampleSchema).optional(),
});

export const ToolpackMetadataSchema = z.object({
  summary: z.string().optional(),
  tools: z.array(ToolpackMetadataToolSchema).optional(),
});
export type ToolpackMetadata = z.infer<typeof ToolpackMetadataSchema>;

// ── Model ───────────────────────────────────────────────────────────

export const OrganizationToolpackSchema = CoreSchema.extend({
  organizationId: z.string(),
  name: z.string().regex(TOOLPACK_SLUG_REGEX),
  description: z.string().nullable(),
  endpoints: ToolpackEndpointsSchema,
  authHeaders: z.record(z.string(), z.string()).nullable(),
  // Phase 6: per-toolpack HMAC signing secret. Plaintext at the
  // model layer (`whsec_*` from `generateSigningSecret()`); the
  // repository encrypts before insert and decrypts on every read.
  // Surfaced to admins only on the registration response and on
  // rotation; encrypted-at-rest otherwise.
  signingSecret: z.string(),
  tools: z.array(ToolpackToolDefinitionSchema).min(1).max(32),
  metadata: ToolpackMetadataSchema.nullable(),
  schemaFetchedAt: z.number(),
  metadataFetchedAt: z.number().nullable(),
});
export type OrganizationToolpack = z.infer<typeof OrganizationToolpackSchema>;

export class OrganizationToolpackModel extends CoreModel<OrganizationToolpack> {
  get schema() {
    return OrganizationToolpackSchema;
  }

  parse(): OrganizationToolpack {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<OrganizationToolpack> {
    return this.schema.safeParse(this._model);
  }
}

export class OrganizationToolpackModelFactory extends ModelFactory<
  OrganizationToolpack,
  OrganizationToolpackModel
> {
  create(createdBy: string): OrganizationToolpackModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    return new OrganizationToolpackModel(baseModel.toJSON());
  }
}
