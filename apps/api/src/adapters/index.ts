export type {
  AccessMode,
  ConnectorAdapter,
  ColumnDefinitionSummary,
  DiscoveredColumn,
  DiscoveredEntity,
  EntityDataQuery,
  EntityDataResult,
  SyncResult,
} from "./adapter.interface.js";

export { ConnectorAdapterRegistry } from "./adapter.registry.js";

export { csvAdapter } from "./csv/index.js";

export { registerAdapters } from "./register.js";
