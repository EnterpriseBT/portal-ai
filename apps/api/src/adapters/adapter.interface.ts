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

/**
 * Per-instance sync result. Phase D's `syncInstance` returns this; the
 * frontend toast displays "X added, Y updated, Z unchanged, W removed".
 */
export interface SyncInstanceResult {
  recordCounts: {
    created: number;
    updated: number;
    unchanged: number;
    deleted: number;
  };
}

/**
 * Result shape for `ConnectorAdapter.assertSyncEligibility`.
 *
 * `reasonCode` is the `ApiCode` string the shared sync route surfaces to
 * the client on refusal. Adapters define and own the codes for
 * connector-specific failure modes (e.g. gsheets's `LAYOUT_PLAN_NOT_FOUND`);
 * the route maps the code into a 4xx response body verbatim.
 *
 * `identityWarnings` is an additive advisory channel: regions whose plan
 * uses `rowPosition` identity sync correctly but produce reap-and-recreate
 * deltas on every structural change, so the UI surfaces a non-blocking
 * warning rather than refusing the sync. Adapters that don't emit it can
 * leave the field undefined.
 */
export interface SyncEligibility {
  ok: boolean;
  reasonCode?: string;
  reason?: string;
  details?: Record<string, unknown>;
  identityWarnings?: { regionId: string }[];
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

  /**
   * Per-instance sync. Optional — connectors that don't support sync
   * (file-upload, sandbox) omit it. The shared sync route resolves
   * the adapter via the connector definition slug and delegates the
   * full pipeline to this method.
   *
   * Per Phase D: load the persisted plan, fetch the source data,
   * replay against the plan, upsert records with a shared
   * `runStartedAt` watermark, soft-delete stale rows, update
   * `lastSyncAt` + clear `lastErrorMessage`. Returns the tally for
   * the SSE consumer's success toast.
   *
   * `progress?: (percent) => void` is the BullMQ processor's
   * `bullJob.updateProgress` callback — fans out to SSE consumers.
   * Optional so unit tests can call `syncInstance` directly.
   *
   * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-D.plan.md` §Slice 4.
   */
  syncInstance?(
    instance: ConnectorInstance,
    userId: string,
    progress?: (percent: number) => void
  ): Promise<SyncInstanceResult>;

  /**
   * Optional connector-specific sync-eligibility gate. Called by the
   * shared sync route + serializer before enqueueing the job (and on
   * GET-by-id to render the disabled-state affordance) so we refuse
   * syncs that we know upfront will fail. Adapters that always accept
   * sync requests (no preconditions beyond `syncInstance` existing)
   * omit the method entirely — the route assumes eligibility.
   *
   * Examples: gsheets refuses when no layout plan is committed or the
   * plan uses positional row identity; a future SQL adapter could
   * refuse when credentials lack SELECT permission on the configured
   * tables.
   *
   * Returns `{ ok: true }` on success or
   * `{ ok: false, reasonCode, reason, details? }` which the route
   * maps to a 4xx ApiError (typically 409).
   */
  assertSyncEligibility?(
    instance: ConnectorInstance
  ): Promise<SyncEligibility>;
}
