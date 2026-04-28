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
  const { instance, slug, connectorDefinition } = args;
  const accountInfo = projectAccountInfo(instance.credentials ?? null, slug);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { credentials: _omit, ...rest } = instance;
  const redacted = { ...rest, accountInfo } as unknown as ConnectorInstanceApi;
  if (connectorDefinition !== undefined) {
    return {
      ...redacted,
      connectorDefinition,
    } as unknown as ConnectorInstanceWithDefinitionApi;
  }
  return redacted;
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
