/**
 * Connector-instance API serializer.
 *
 * `ConnectorInstancesRepository` decrypts `credentials` on every read.
 * Routes must redact `credentials` from the wire and surface the
 * connector-defined public projection (`accountInfo`) instead. Centralized
 * here so any new connector-instance route inherits the redaction by
 * default and the security review surface stays one file.
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-A.plan.md` §Slice 9.
 */

import {
  EMPTY_ACCOUNT_INFO,
  type ConnectorInstanceApi,
  type ConnectorInstanceWithDefinitionApi,
  type PublicAccountInfo,
} from "@portalai/core/contracts";
import type { ConnectorInstance } from "@portalai/core/models";
import type { ConnectorDefinitionSelect } from "../db/schema/zod.js";

import { ConnectorAdapterRegistry } from "../adapters/adapter.registry.js";

/**
 * Anything the repository returns has a decrypted `credentials` object;
 * we type-loosely accept that here and strip it on the way out.
 */
interface InstanceLike {
  credentials?: Record<string, unknown> | null | string;
  connectorDefinitionId: string;
  // Plus all the rest of the columns — preserved by spread.
  [key: string]: unknown;
}

interface RedactInstanceArgs {
  instance: InstanceLike;
  /** Slug used to look up the adapter's `toPublicAccountInfo`. */
  slug: string;
  /**
   * Optional connector definition to attach to the response (for the
   * "with definition" endpoints). When omitted, the redacted instance
   * is returned without a `connectorDefinition` field.
   */
  connectorDefinition?: ConnectorDefinitionSelect | null;
  /**
   * Pre-resolved sync eligibility for the instance. Computed by the
   * caller (typically the GET-by-id route) via `computeSyncEligible`
   * below. Omit on list endpoints where computing it per row would be
   * n+1 — the field becomes `undefined` on the wire and the UI hides
   * the sync affordance until the detail view resolves it.
   */
  syncEligible?: boolean;
  /**
   * Non-blocking advisories from the adapter's `assertSyncEligibility`
   * (e.g. `rowPosition`-identity regions on the gsheets adapter).
   * Resolved by the GET-by-id route via `computeIdentityWarnings`;
   * omitted on list endpoints to avoid n+1 plan lookups.
   */
  identityWarnings?: { regionId: string }[];
}

export function redactInstance(
  args: RedactInstanceArgs & { connectorDefinition: ConnectorDefinitionSelect | null }
): ConnectorInstanceWithDefinitionApi;
export function redactInstance(
  args: RedactInstanceArgs
): ConnectorInstanceApi;
export function redactInstance(
  args: RedactInstanceArgs
): ConnectorInstanceApi | ConnectorInstanceWithDefinitionApi {
  const { instance, slug, connectorDefinition, syncEligible, identityWarnings } =
    args;
  const accountInfo = projectAccountInfo(instance.credentials ?? null, slug);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { credentials: _omit, ...rest } = instance;
  const redacted = {
    ...rest,
    accountInfo,
    ...(syncEligible !== undefined ? { syncEligible } : {}),
    ...(identityWarnings !== undefined ? { identityWarnings } : {}),
  } as unknown as ConnectorInstanceApi;
  if (connectorDefinition !== undefined) {
    return {
      ...redacted,
      connectorDefinition,
    } as unknown as ConnectorInstanceWithDefinitionApi;
  }
  return redacted;
}

/**
 * Resolve `syncEligible` for a single instance by delegating to the
 * connector adapter's `assertSyncEligibility` (when defined). Returns:
 *   - `true`  — adapter accepts a sync now (or has no eligibility gate),
 *               including plans whose regions use `rowPosition` identity
 *               (those produce `identityWarnings` advisories, not refusals)
 *   - `false` — adapter refuses (e.g. gsheets without a committed plan)
 *   - `false` — connector type does not support sync at all
 *
 * Used by GET-by-id; list endpoints skip this to avoid n+1. The route
 * passes the already-fetched instance + slug so we don't double-fetch.
 */
export async function computeSyncEligible(
  instance: ConnectorInstance,
  slug: string
): Promise<boolean> {
  const adapter = ConnectorAdapterRegistry.find(slug);
  if (!adapter?.syncInstance) return false;
  if (!adapter.assertSyncEligibility) return true;
  const result = await adapter.assertSyncEligibility(instance);
  return result.ok;
}

/**
 * Resolve the adapter's `identityWarnings` for the given instance. Returns
 * the array verbatim from `assertSyncEligibility` (typically empty for
 * stable plans, populated for `rowPosition` regions on gsheets), `[]`
 * when the adapter doesn't define an eligibility gate, or `undefined`
 * when the connector type doesn't support sync at all (the field is
 * meaningless there).
 *
 * Used by GET-by-id alongside `computeSyncEligible`. List endpoints skip
 * this — populating it per row would be n+1 across the workspace's
 * connector instances.
 */
export async function computeIdentityWarnings(
  instance: ConnectorInstance,
  slug: string
): Promise<{ regionId: string }[] | undefined> {
  const adapter = ConnectorAdapterRegistry.find(slug);
  if (!adapter?.syncInstance) return undefined;
  if (!adapter.assertSyncEligibility) return [];
  const result = await adapter.assertSyncEligibility(instance);
  return result.identityWarnings ?? [];
}

/**
 * Bulk variant for list endpoints. The slug for each row is derived from
 * an attached `connectorDefinition` (when the caller used `include`) or
 * from a slug-by-id map the caller assembles from a single
 * `findMany({ ids })` lookup. Either way, the redactor never falls back
 * to "unknown slug" unless the row genuinely has no resolvable adapter.
 */
export function redactInstances(
  rows: (InstanceLike & {
    connectorDefinition?: ConnectorDefinitionSelect | null;
  })[],
  slugByDefinitionId: Map<string, string>
): (ConnectorInstanceApi | ConnectorInstanceWithDefinitionApi)[] {
  return rows.map((row) => {
    const slug =
      (row.connectorDefinition && row.connectorDefinition.slug) ||
      slugByDefinitionId.get(row.connectorDefinitionId) ||
      "";
    if (row.connectorDefinition !== undefined) {
      return redactInstance({
        instance: row,
        slug,
        connectorDefinition: row.connectorDefinition ?? null,
      });
    }
    return redactInstance({ instance: row, slug });
  });
}

function projectAccountInfo(
  credentials: Record<string, unknown> | null | string | undefined,
  slug: string
): PublicAccountInfo {
  // The repository may hand back a string in edge cases (rows fetched via
  // a path that bypasses the decrypt overrides). Treat as opaque — never
  // return string contents in `accountInfo` and never throw.
  if (typeof credentials === "string") return EMPTY_ACCOUNT_INFO;
  const adapter = ConnectorAdapterRegistry.find(slug);
  return adapter?.toPublicAccountInfo?.(credentials ?? null) ?? EMPTY_ACCOUNT_INFO;
}
