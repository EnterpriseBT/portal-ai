/**
 * #644: authoring an advanced (SQL) curated-view row filter.
 *
 * A filter is checked the same way whoever wrote it: statically by
 * `validateViewFilterSql` (the boundary), then created and read as the reader
 * role against the entity's current columns (the dry-run), so it is refused
 * at save time with a reason the author can act on instead of breaking the
 * view later. Saving needs the tier's `advancedViewFilters` entitlement.
 */
import type {
  CuratedViewFilterSqlPreviewResponsePayload,
  CuratedViewFilterSqlSuggestResponsePayload,
} from "@portalai/core/contracts";

import { ApiError } from "./http.service.js";
import { EntitlementService } from "./entitlement.service.js";
import { PortalSqlService } from "./portal-sql.service.js";
import { PortalSqlReaderRoleService } from "./portal-sql-reader-role.service.js";
import {
  FilterSqlSuggestError,
  getFilterSqlSuggester,
} from "./curated-view-filter-suggest.haiku.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { resolveColumns } from "../utils/resolve-columns.util.js";
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

  /** The first rows a draft filter selects (no total), as the reader role. */
  static async preview(params: {
    organizationId: string;
    connectorEntityId: string;
    filterSql: string;
    fieldMappingIds?: string[];
  }): Promise<CuratedViewFilterSqlPreviewResponsePayload> {
    await PortalSqlReaderRoleService.assertUsable();
    return PortalSqlService.previewViewFilterSql(
      {
        connectorEntityId: params.connectorEntityId,
        filterSql: params.filterSql,
        fieldMappingIds: params.fieldMappingIds,
      },
      params.organizationId
    );
  }

  /**
   * Ask the model for a filter matching the author's description, then hold
   * it to the same validator and dry-run as a hand-written one. A refused
   * suggestion gets one revision, told why; if that fails too, or the model
   * call fails, `502 CURATED_VIEW_FILTER_SUGGEST_FAILED` (hand-editing is
   * unaffected). Not metered: one-shot assist calls aren't, and the tier
   * entitlement is the paid axis.
   */
  static async suggest(params: {
    organizationId: string;
    connectorEntityId: string;
    prompt: string;
    currentSql?: string;
  }): Promise<CuratedViewFilterSqlSuggestResponsePayload> {
    await PortalSqlReaderRoleService.assertUsable();
    const resolved = await resolveColumns(params.connectorEntityId);
    const jsonKeys = await PortalSqlService.sampleJsonKeys(
      params.connectorEntityId,
      params.organizationId,
      resolved.filter((c) => c.type === "json").map((c) => c.normalizedKey)
    );
    const columns = resolved.map((c) => ({
      key: c.normalizedKey,
      type: c.type,
      ...(jsonKeys.get(c.normalizedKey)
        ? { jsonKeys: jsonKeys.get(c.normalizedKey) }
        : {}),
    }));

    const suggester = getFilterSqlSuggester();
    const failed = (message: string) =>
      new ApiError(
        502,
        ApiCode.CURATED_VIEW_FILTER_SUGGEST_FAILED,
        `Couldn't suggest a filter: ${message}. You can still write one by hand.`
      );
    const ask = async (previousAttempt?: {
      filterSql: string;
      error: string;
    }) => {
      try {
        return (
          await suggester.suggest({
            prompt: params.prompt,
            columns,
            currentSql: params.currentSql,
            previousAttempt,
          })
        ).filterSql;
      } catch (err) {
        // The provider's own error text stays in the log (a 502's message
        // reaches the client); the reason here is the user's to read.
        if (err instanceof FilterSqlSuggestError) {
          throw failed("the suggestion service didn't respond");
        }
        throw err;
      }
    };
    const check = async (filterSql: string): Promise<string | null> => {
      try {
        await CuratedViewFilterSqlService.validateAndDryRun(
          params.connectorEntityId,
          params.organizationId,
          filterSql
        );
        return null;
      } catch (err) {
        if (
          err instanceof ApiError &&
          err.code === ApiCode.CURATED_VIEW_INVALID_FILTER_SQL
        ) {
          return err.message;
        }
        throw err;
      }
    };

    const first = await ask();
    const firstError = await check(first);
    if (firstError === null) return { filterSql: first, warning: null };
    const revised = await ask({ filterSql: first, error: firstError });
    const revisedError = await check(revised);
    if (revisedError !== null) throw failed(revisedError);
    return {
      filterSql: revised,
      warning: `The first suggestion was refused (${firstError}); this is a corrected one.`,
    };
  }
}
