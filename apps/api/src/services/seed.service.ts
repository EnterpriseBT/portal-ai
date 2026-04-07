import { ConnectorDefinition, ColumnDefinition, ColumnDefinitionModelFactory, CSVConnectorDefinitionModelFactory, SandboxConnectorDefinitionModelFactory } from "@portalai/core/models";
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
}

const SYSTEM_COLUMN_DEFINITIONS: SystemColumnDefinitionSpec[] = [
  {
    key: "uuid",
    label: "UUID",
    type: "string",
    description: "Universally unique identifier",
    validationPattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    validationMessage: "Must be a valid UUID",
    canonicalFormat: "lowercase",
  },
  {
    key: "email",
    label: "Email",
    type: "string",
    description: "Email address",
    validationPattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
    validationMessage: "Must be a valid email address",
    canonicalFormat: "lowercase",
  },
  {
    key: "phone",
    label: "Phone",
    type: "string",
    description: "Phone number",
    validationPattern: "^\\+?[\\d\\s\\-().]+$",
    validationMessage: "Must be a valid phone number",
    canonicalFormat: "phone",
  },
  {
    key: "date",
    label: "Date",
    type: "date",
    description: "Calendar date",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
  },
  {
    key: "datetime",
    label: "Date & Time",
    type: "datetime",
    description: "Date and time with timezone",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
  },
  {
    key: "name",
    label: "Name",
    type: "string",
    description: "Person or entity name",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: "trim",
  },
  {
    key: "description",
    label: "Description",
    type: "string",
    description: "Free-text description",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: "trim",
  },
  {
    key: "currency",
    label: "Currency",
    type: "number",
    description: "Monetary amount with 2 decimal places",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: "$#,##0.00",
  },
];

export class SeedService {

  async seed() {
    const { tx, commit, rollback } = await DbService.createTransactionClient();
    try {
      await this.seedConnectorDefinitions(tx)
        .catch((error) => {
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
      new SandboxConnectorDefinitionModelFactory().create(SystemUtilities.id.system)
        .update({
          slug: "sandbox",
          display: "Sandbox",
          category: "Built-in",
          authType: "none",
          isActive: true,
          configSchema: {},
          capabilityFlags: {
            sync: false,
            query: true,
            write: true,
          },
          version: "1.0.0",
          iconUrl: 'https://res.cloudinary.com/dvloutv7e/image/upload/v1775089873/sandbox_ntatbt.png',
        }).parse(),
      new CSVConnectorDefinitionModelFactory().create(SystemUtilities.id.system)
        .update({
          slug: "csv",
          display: "CSV Connector",
          category: "File-based",
          authType: "none",
          isActive: true,
          configSchema: {},
          capabilityFlags: {
            sync: false,
            query: true,
            write: true,
          },
          version: "1.0.0",
          iconUrl: 'https://res.cloudinary.com/dvloutv7e/image/upload/v1773338114/CSV_Icons_oad8ko.png',
        }).parse(),
    ];

    await DbService.repository.connectorDefinitions.upsertManyBySlug(connectors, db)
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

    const definitions: ColumnDefinition[] = SYSTEM_COLUMN_DEFINITIONS.map((spec) => {
      return factory.create(SystemUtilities.id.system)
        .update({
          id: SystemUtilities.id.v5.generate(`column-definition:${organizationId}:${spec.key}`),
          organizationId,
          ...spec,
        })
        .parse();
    });

    for (const def of definitions) {
      await DbService.repository.columnDefinitions.upsertByKey(def, db);
    }
  }
}