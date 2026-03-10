import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Connector Definitions model.
 * Extends CoreModel with connector-specific metadata fields.
 *
 * Sync with the Drizzle `connector_definitions` table is enforced at
 * compile time via `apps/api/src/db/schema/type-checks.ts` and at
 * runtime via drizzle-zod derived schemas in
 * `apps/api/src/db/schema/zod.ts`.
 */
export const ConnectorDefinitionSchema = CoreSchema.extend({
  slug: z.string(),
  display: z.string(),
  category: z.string(),
  authType: z.string(),
  configSchema: z.record(z.string(), z.unknown()).nullable(),
  capabilityFlags: z.object({
    sync: z.boolean().optional(),
    query: z.boolean().optional(),
    write: z.boolean().optional(),
  }),
  isActive: z.boolean(),
  version: z.string(),
  iconUrl: z.string().nullable(),
});

export type ConnectorDefinition = z.infer<typeof ConnectorDefinitionSchema>;

export class ConnectorDefinitionModel extends CoreModel<ConnectorDefinition> {
  get schema() {
    return ConnectorDefinitionSchema;
  }

  parse(): ConnectorDefinition {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<ConnectorDefinition> {
    return this.schema.safeParse(this._model);
  }
}

export class ConnectorDefinitionModelFactory extends ModelFactory<
  ConnectorDefinition,
  ConnectorDefinitionModel
> {
  create(createdBy: string): ConnectorDefinitionModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const connectorDefinitionsModel = new ConnectorDefinitionModel(baseModel.toJSON());
    return connectorDefinitionsModel;
  }
}

// ── CSV parse options (upload-time) ───────────────────────────────────

/**
 * Parse-level settings for CSV connectors.
 * Determined by the user at upload time, stored on the upload record.
 */
export const CSVParseOptionsSchema = z.object({
  delimiter: z.enum([",", ";", "\t", "|"]).default(","),
  hasHeader: z.boolean().default(true),
  encoding: z.enum(["utf-8", "latin1", "ascii"]).default("utf-8"),
  skipRows: z.number().int().nonnegative().default(0),
  nullValues: z.array(z.string()).default(["", "NULL", "null", "N/A"]),
});

export type CSVParseOptions = z.infer<typeof CSVParseOptionsSchema>;

// ── CSV column schema (upload-time) ──────────────────────────────────

export const CSVColumnSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "date", "enum"]),
  required: z.boolean().default(true),
  format: z.string().optional(),        // e.g. date format "YYYY-MM-DD"
  enumValues: z.array(z.string()).optional(),
});

export type CSVColumn = z.infer<typeof CSVColumnSchema>;

// ── Full resolved config (parse options + columns) ───────────────────

/**
 * The complete CSV config with columns resolved.
 * Used at runtime validation — NOT on the connector definition itself.
 */
export const CSVConnectorConfigSchema = CSVParseOptionsSchema.extend({
  columns: z.array(CSVColumnSchema).min(1),
});

export type CSVConnectorConfig = z.infer<typeof CSVConnectorConfigSchema>;

// ── CSV Connector Definition ──────────────────────────────────────────

/**
 * CSV Connector Definition schema.
 * Parse options and column mappings are determined per-upload, not here.
 */
export const CSVConnectorDefinitionSchema = ConnectorDefinitionSchema.extend({
  // empty for now, but could add CSV-specific metadata fields here in the future
});

export type CSVConnectorDefinition = z.infer<typeof CSVConnectorDefinitionSchema>;

export class CSVConnectorDefinitionModel extends CoreModel<CSVConnectorDefinition> {
  get schema() {
    return CSVConnectorDefinitionSchema;
  }

  parse(): CSVConnectorDefinition {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<CSVConnectorDefinition> {
    return this.schema.safeParse(this._model);
  }
}

export class CSVConnectorDefinitionModelFactory extends ModelFactory<
  CSVConnectorDefinition,
  CSVConnectorDefinitionModel
> {
  create(createdBy: string): CSVConnectorDefinitionModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const csvConnectorDefinitionModel = new CSVConnectorDefinitionModel(baseModel.toJSON());
    return csvConnectorDefinitionModel;
  }
}
