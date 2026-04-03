/**
 * CSV Connector Adapter.
 *
 * Access mode: `import` — all reads come from the local `entity_records`
 * table. Syncing re-imports from the source file.
 *
 * `queryRows` delegates to the shared `importModeQueryRows` utility.
 *
 * `syncEntity` and discovery methods are no-ops for CSV — data is imported
 * via the bulk import API endpoint during the CSV upload workflow.
 */

import type { ConnectorAdapter } from "../adapter.interface.js";
import { importModeQueryRows } from "../../utils/adapter.util.js";

export const csvAdapter: ConnectorAdapter = {
  accessMode: "import",
  queryRows: importModeQueryRows,
  async syncEntity() {
    return { created: 0, updated: 0, unchanged: 0, errors: 0 };
  },
  async discoverEntities() {
    return [];
  },
  async discoverColumns() {
    return [];
  },
};
