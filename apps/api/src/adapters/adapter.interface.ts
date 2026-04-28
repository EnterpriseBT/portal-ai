import type { ConnectorInstance, ColumnDataType } from "@portalai/core/models";
import type {
  PublicAccountInfo,
  ResolvedColumn,
} from "@portalai/core/contracts";

// ── Query / Result types ────────────────────────────────────────────

export interface EntityDataQuery {
  entityKey: string;
  columns?: string[];
  limit: number;
  offset: number;
  sort?: { column: string; direction: "asc" | "desc" };
  filters?: Record<
    string,
    { op: "eq" | "neq" | "contains" | "gt" | "lt"; value: unknown }
  >;
}

export type { ResolvedColumn };

export interface EntityDataResult {
  rows: Record<string, unknown>[];
  total: number;
  columns: ResolvedColumn[];
  source: "cache" | "live";
}

export interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  errors: number;
}

export interface DiscoveredEntity {
  key: string;
  label: string;
}

export interface DiscoveredColumn {
  key: string;
  label: string;
  type: ColumnDataType;
  required: boolean;
}

// ── Adapter interface ───────────────────────────────────────────────

export interface ConnectorAdapter {
  queryRows(
    instance: ConnectorInstance,
    query: EntityDataQuery
  ): Promise<EntityDataResult>;

  syncEntity(
    instance: ConnectorInstance,
    entityKey: string
  ): Promise<SyncResult>;

  discoverEntities(instance: ConnectorInstance): Promise<DiscoveredEntity[]>;

  discoverColumns(
    instance: ConnectorInstance,
    entityKey: string
  ): Promise<DiscoveredColumn[]>;

  /**
   * Project the decrypted credentials blob into the public `accountInfo`
   * shape rendered on the connector card chip + detail view. Adapters
   * implement this to surface non-secret fields (e.g. the authenticated
   * account's email); omit the method entirely to opt out (the serializer
   * defaults to `EMPTY_ACCOUNT_INFO`).
   *
   * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-A.plan.md` §Slice 9.
   */
  toPublicAccountInfo?(
    credentials: Record<string, unknown> | null
  ): PublicAccountInfo;
}
