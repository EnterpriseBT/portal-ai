import { ConnectorDefinition, CSVConnectorDefinitionModelFactory } from "@mcp-ui/core/models";
import { DbClient } from "../db/index.js";
import { DbService } from "./db.service.js";
import { SystemUtilities } from "../utils/system.util.js";

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
      new CSVConnectorDefinitionModelFactory().create(SystemUtilities.id.system)
        .update({
          slug: "csv",
          display: "CSV Connector",
          category: "File-based",
          authType: "none",
          isActive: true,
          configSchema: {},
          capabilityFlags: {
            sync: true,
            query: true,
            write: false,
          },
          version: "1.0.0",
          iconUrl: null,
        }).parse()

      // Add more connectors as needed
    ];

    await DbService.repository.connectorDefinitions.upsertManyBySlug(connectors, db)
      .catch((error) => {
        console.error("Error upserting connector definitions:", error);
        throw error; // Rethrow to trigger rollback
      });
  }
}