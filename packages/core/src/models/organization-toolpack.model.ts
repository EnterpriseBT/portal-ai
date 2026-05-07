import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

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

export const ToolpackEndpointsSchema = z.object({
  schema: z.string().url(),
  runtime: z.string().url(),
  metadata: z.string().url().optional(),
});
export type ToolpackEndpoints = z.infer<typeof ToolpackEndpointsSchema>;

// ── Tool definition ─────────────────────────────────────────────────

export const ToolpackToolDefinitionSchema = z.object({
  name: z.string().regex(TOOLPACK_SLUG_REGEX),
  description: z.string().min(1),
  parameterSchema: z.record(z.string(), z.unknown()),
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
