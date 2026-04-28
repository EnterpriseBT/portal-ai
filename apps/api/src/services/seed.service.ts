import {
  ConnectorDefinition,
  ColumnDefinition,
  ColumnDefinitionModelFactory,
  FileUploadConnectorDefinitionModelFactory,
  GoogleSheetsConnectorDefinitionModelFactory,
  SandboxConnectorDefinitionModelFactory,
} from "@portalai/core/models";
import type { ColumnDataType } from "@portalai/core/models";
import { DbClient } from "../db/index.js";
import { DbService } from "./db.service.js";
import { SystemUtilities } from "../utils/system.util.js";

interface SystemColumnDefinitionSpec {
  key: string;
  label: string;
  type: ColumnDataType;
  description: string;
  validationPattern: string | null;
  validationMessage: string | null;
  canonicalFormat: string | null;
  system: true;
}

export const SYSTEM_COLUMN_DEFINITIONS: SystemColumnDefinitionSpec[] = [
  {
    key: "uuid",
    label: "UUID",
    type: "string",
    description: "Universally unique identifier",
    validationPattern:
      "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    validationMessage: "Must be a valid UUID",
    canonicalFormat: "lowercase",
    system: true,
  },
  {
    key: "string_id",
    label: "String ID",
    type: "string",
    description: "Alphanumeric string identifier",
    validationPattern: "^[A-Za-z0-9_\\-]+$",
    validationMessage:
      "Must contain only letters, numbers, hyphens, and underscores",
    canonicalFormat: "trim",
    system: true,
  },
  {
    key: "number_id",
    label: "Number ID",
    type: "number",
    description: "Numeric identifier",
    validationPattern: "^\\d+$",
    validationMessage: "Must be a whole number",
    canonicalFormat: null,
    system: true,
  },
  {
    key: "email",
    label: "Email",
    type: "string",
    description: "Email address",
    validationPattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
    validationMessage: "Must be a valid email address",
    canonicalFormat: "lowercase",
    system: true,
  },
  {
    key: "phone",
    label: "Phone",
    type: "string",
    description: "Phone number",
    validationPattern: "^\\+?[\\d\\s\\-().]+$",
    validationMessage: "Must be a valid phone number",
    canonicalFormat: "phone",
    system: true,
  },
  {
    key: "url",
    label: "Website",
    type: "string",
    description: "Website URL",
    validationPattern: "^https?://[^\\s]+$",
    validationMessage: "Must be a valid URL starting with http:// or https://",
    canonicalFormat: "lowercase",
    system: true,
  },
  {
    key: "name",
    label: "Name",
    type: "string",
    description: "Person or entity name",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: "trim",
    system: true,
  },
  {
    key: "description",
    label: "Description",
    type: "string",
    description: "Free-text description",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: "trim",
    system: true,
  },
  {
    key: "text",
    label: "Text",
    type: "string",
    description: "General-purpose text content",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: "trim",
    system: true,
  },
  {
    key: "code",
    label: "Code",
    type: "string",
    description: "Short code or abbreviation",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: "uppercase",
    system: true,
  },
  {
    key: "address",
    label: "Address",
    type: "string",
    description: "Physical or mailing address",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: "trim",
    system: true,
  },
  {
    key: "status",
    label: "Status",
    type: "string",
    description: "Status indicator or label",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: "lowercase",
    system: true,
  },
  {
    key: "tag",
    label: "Tag",
    type: "string",
    description: "Categorical tag or label",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: "lowercase",
    system: true,
  },
  {
    key: "integer",
    label: "Integer",
    type: "number",
    description: "Whole number without decimals",
    validationPattern: "^-?\\d+$",
    validationMessage: "Must be a whole number",
    canonicalFormat: "#,##0",
    system: true,
  },
  {
    key: "decimal",
    label: "Decimal",
    type: "number",
    description: "Number with decimal precision",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: "#,##0.00",
    system: true,
  },
  {
    key: "percentage",
    label: "Percentage",
    type: "number",
    description: "Percentage value",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: "0.00%",
    system: true,
  },
  {
    key: "currency",
    label: "Currency",
    type: "number",
    description: "Monetary amount with 2 decimal places",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: "$#,##0.00",
    system: true,
  },
  {
    key: "quantity",
    label: "Quantity",
    type: "number",
    description: "Count or measurable quantity",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: "#,##0",
    system: true,
  },
  {
    key: "boolean",
    label: "Boolean",
    type: "boolean",
    description: "True or false value",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    system: true,
  },
  {
    key: "date",
    label: "Date",
    type: "date",
    description: "Calendar date",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    system: true,
  },
  {
    key: "datetime",
    label: "Date & Time",
    type: "datetime",
    description: "Date and time with timezone",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    system: true,
  },
  {
    key: "enum",
    label: "Enum",
    type: "enum",
    description: "Value from a predefined set of options",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    system: true,
  },
  {
    key: "json_data",
    label: "JSON Data",
    type: "json",
    description: "Structured JSON object or value",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    system: true,
  },
  {
    key: "array",
    label: "Array",
    type: "array",
    description: "Ordered list of values",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    system: true,
  },
  {
    key: "reference",
    label: "Reference",
    type: "reference",
    description: "Reference to another entity record",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    system: true,
  },
  {
    key: "reference_array",
    label: "Reference Array",
    type: "reference-array",
    description: "Multiple references to other entity records",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    system: true,
  },
];

export class SeedService {
  async seed() {
    const { tx, commit, rollback } = await DbService.createTransactionClient();
    try {
      await this.seedConnectorDefinitions(tx).catch((error) => {
        console.error("Error seeding connector definitions:", error);
        throw error; // Rethrow to trigger rollback
      });
      await commit();
    } catch (error) {
      console.error("Error during seeding:", error);
      await rollback();
    }
  }

  async seedConnectorDefinitions(db: DbClient) {
    const connectors: ConnectorDefinition[] = [
      new SandboxConnectorDefinitionModelFactory()
        .create(SystemUtilities.id.system)
        .update({
          slug: "sandbox",
          display: "Sandbox",
          category: "Built-in",
          authType: "none",
          isActive: true,
          configSchema: {},
          capabilityFlags: {
            sync: false,
            read: true,
            write: true,
            push: false,
          },
          version: "1.0.0",
          iconUrl:
            "https://res.cloudinary.com/dvloutv7e/image/upload/v1776276948/sandbox_zlwqke.png",
        })
        .parse(),
      new FileUploadConnectorDefinitionModelFactory()
        .create(SystemUtilities.id.system)
        .update({
          slug: "file-upload",
          display: "File Upload",
          category: "File-based",
          authType: "none",
          isActive: true,
          configSchema: {},
          capabilityFlags: {
            sync: false,
            read: true,
            write: true,
            push: false,
          },
          version: "1.0.0",
          iconUrl:
            "https://res.cloudinary.com/dvloutv7e/image/upload/v1777417496/file-upload-svgrepo-com_uyhuzm.svg",
        })
        .parse(),
      // Phase A: definition seeded but `isActive: false` so the UI doesn't
      // surface it until Phase C wires the workflow. See
      // docs/GOOGLE_SHEETS_CONNECTOR.phase-A.plan.md §Slice 6.
      new GoogleSheetsConnectorDefinitionModelFactory()
        .create(SystemUtilities.id.system)
        .update({
          slug: "google-sheets",
          display: "Google Sheets",
          category: "File-based",
          authType: "oauth2",
          isActive: false,
          configSchema: {},
          capabilityFlags: {
            sync: true,
            read: true,
            write: false,
            push: false,
          },
          version: "1.0.0",
          iconUrl:
            "https://res.cloudinary.com/dvloutv7e/image/upload/v1777417496/google-sheets-svgrepo-com_placeholder.svg",
        })
        .parse(),
    ];

    await DbService.repository.connectorDefinitions
      .upsertManyBySlug(connectors, db)
      .catch((error) => {
        console.error("Error upserting connector definitions:", error);
        throw error; // Rethrow to trigger rollback
      });
  }

  /**
   * Seeds a core set of system column definitions for an organization.
   * Uses deterministic v5 UUIDs and upsertByKey so calls are idempotent.
   */
  async seedSystemColumnDefinitions(organizationId: string, db: DbClient) {
    const factory = new ColumnDefinitionModelFactory();

    const definitions: ColumnDefinition[] = SYSTEM_COLUMN_DEFINITIONS.map(
      (spec) => {
        return factory
          .create(SystemUtilities.id.system)
          .update({
            id: SystemUtilities.id.v4.generate(),
            organizationId,
            ...spec,
          })
          .parse();
      }
    );

    for (const def of definitions) {
      await DbService.repository.columnDefinitions.upsertByKey(def, db);
    }
  }
}
