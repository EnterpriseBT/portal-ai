/**
 * #644: authoring an advanced (SQL) curated-view row filter.
 *
 * A filter is checked the same way whoever wrote it: statically by
 * `validateViewFilterSql` (the boundary), then created and read as the reader
 * role against the entity's current columns (the dry-run), so it is refused
 * at save time with a reason the author can act on instead of breaking the
 * view later. Saving needs the tier's `advancedViewFilters` entitlement.
 */
import { ApiError } from "./http.service.js";
import { EntitlementService } from "./entitlement.service.js";
import { PortalSqlService } from "./portal-sql.service.js";
import { PortalSqlReaderRoleService } from "./portal-sql-reader-role.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import type { DbClient } from "../db/repositories/base.repository.js";

export class CuratedViewFilterSqlService {
  /**
   * Refuse with `403 CURATED_VIEW_FILTER_SQL_NOT_ENTITLED` unless the org's
   * tier includes advanced view filters. Only setting or changing a SQL
   * filter needs it: clearing one, or resending the stored text, doesn't.
   */
  static async assertEntitled(organizationId: string): Promise<void> {
    if (await EntitlementService.advancedViewFiltersEntitled(organizationId)) {
      return;
    }
    throw new ApiError(
      403,
      ApiCode.CURATED_VIEW_FILTER_SQL_NOT_ENTITLED,
      "This organization's plan doesn't include advanced (SQL) view filters."
    );
  }

  /**
   * The checks before the write's transaction opens. The reader-role probe
   * uses its own pooled connection, so it must run before the write holds
   * one (#314).
   */
  static async beforeWrite(organizationId: string): Promise<void> {
    await CuratedViewFilterSqlService.assertEntitled(organizationId);
    await PortalSqlReaderRoleService.assertUsable();
  }

  /**
   * Validate and dry-run a filter against the entity's current columns on
   * `client` (the write's transaction, under its view-dependency lock).
   * Throws `400 CURATED_VIEW_INVALID_FILTER_SQL`; returns the referenced keys.
   */
  static async validateAndDryRun(
    connectorEntityId: string,
    organizationId: string,
    filterSql: string,
    client?: DbClient
  ): Promise<{ keys: string[] }> {
    return PortalSqlService.dryRunViewFilterSql(
      { connectorEntityId, filterSql },
      organizationId,
      client
    );
  }
}
