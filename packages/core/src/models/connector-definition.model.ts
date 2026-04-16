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
    read: z.boolean().optional(),
    write: z.boolean().optional(),
    push: z.boolean().optional(),
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

// ── File Upload Connector Definition ──────────────────────────────────
//
// Represents the unified CSV + XLSX upload connector. Format-specific
// behavior (delimiter detection, sheet handling) lives in the streaming
// parsers and processor; the connector definition itself carries no
// format-specific data, since the user uploads files of either format
// through one workflow and the backend routes by extension.

/**
 * File Upload Connector Definition schema.
 *
 * Parse options and column mappings are determined per-upload by the
 * streaming parsers, not here.
 */
export const FileUploadConnectorDefinitionSchema = ConnectorDefinitionSchema.extend({
  // No format-specific fields. CSV vs XLSX is decided per-file at parse time.
});

export type FileUploadConnectorDefinition = z.infer<typeof FileUploadConnectorDefinitionSchema>;

export class FileUploadConnectorDefinitionModel extends CoreModel<FileUploadConnectorDefinition> {
  get schema() {
    return FileUploadConnectorDefinitionSchema;
  }

  parse(): FileUploadConnectorDefinition {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<FileUploadConnectorDefinition> {
    return this.schema.safeParse(this._model);
  }
}

export class FileUploadConnectorDefinitionModelFactory extends ModelFactory<
  FileUploadConnectorDefinition,
  FileUploadConnectorDefinitionModel
> {
  create(createdBy: string): FileUploadConnectorDefinitionModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const fileUploadConnectorDefinitionModel = new FileUploadConnectorDefinitionModel(baseModel.toJSON());
    return fileUploadConnectorDefinitionModel;
  }
}

// ── Sandbox Connector Definition ─────────────────────────────────────

export const SandboxConnectorDefinitionSchema = ConnectorDefinitionSchema.extend({});

export type SandboxConnectorDefinition = z.infer<typeof SandboxConnectorDefinitionSchema>;

export class SandboxConnectorDefinitionModel extends CoreModel<SandboxConnectorDefinition> {
  get schema() {
    return SandboxConnectorDefinitionSchema;
  }

  parse(): SandboxConnectorDefinition {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<SandboxConnectorDefinition> {
    return this.schema.safeParse(this._model);
  }
}

export class SandboxConnectorDefinitionModelFactory extends ModelFactory<
  SandboxConnectorDefinition,
  SandboxConnectorDefinitionModel
> {
  create(createdBy: string): SandboxConnectorDefinitionModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const sandboxConnectorDefinitionModel = new SandboxConnectorDefinitionModel(baseModel.toJSON());
    return sandboxConnectorDefinitionModel;
  }
}
