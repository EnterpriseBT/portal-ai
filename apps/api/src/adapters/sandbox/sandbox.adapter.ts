/**
 * Sandbox Connector Adapter.
 *
 * All reads come from the local `entity_records` table via the shared
 * import-mode utility. Discovery methods are no-ops — sandbox data is
 * managed directly through the API.
 */

import type { ConnectorAdapter } from "../adapter.interface.js";
import { importModeQueryRows } from "../../utils/adapter.util.js";

export const sandboxAdapter: ConnectorAdapter = {
  queryRows: importModeQueryRows,
  async discoverEntities() {
    return [];
  },
  async discoverColumns() {
    return [];
  },
};
