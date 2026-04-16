export type {
  ConnectorAdapter,
  ResolvedColumn,
  DiscoveredColumn,
  DiscoveredEntity,
  EntityDataQuery,
  EntityDataResult,
  SyncResult,
} from "./adapter.interface.js";

export { ConnectorAdapterRegistry } from "./adapter.registry.js";

export { registerAdapters } from "./register.js";
