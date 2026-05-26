/**
 * Single-page fetch helpers shared by the sync loop, `testConnection`,
 * and `discoverColumns` (probe).
 *
 *   - `fetchOnePage`  — given a `PageContext`, build the URL (or use
 *     `overrideUrl` for linkHeader), apply templating, splice
 *     pagination params, apply auth, wrap in withRetry, walk
 *     `recordsPath`, assert array. The per-page primitive.
 *
 *   - `fetchFirstPage` — drive the per-strategy iterator exactly once.
 *     Used by `testConnection` (page-1 dry run) and `discoverColumns`
 *     (probe sample). The iterator's response-inspection step still
 *     runs (cursor extraction, Link header parsing) so config errors
 *     surface; we just don't iterate beyond page 1.
 *
 * Pulled out of `rest-api.adapter.ts` so the sync loop, test-connection,
 * and probe share one source of truth for "fetch a single REST API
 * page." A change to auth / templating / retries lands in one place.
 */
import type {
  ApiAuthConfig,
  ApiCredentials,
  PaginationConfig,
} from "@portalai/core/models";

import { ApiCode } from "../../constants/api-codes.constants.js";
import { ApiError } from "../../services/http.service.js";
import type { ApiEndpoint } from "../../db/repositories/api-endpoints.repository.js";
import { applyAuth } from "./auth.util.js";
import { fetchJson, type FetchJsonResult } from "./fetch.util.js";
import { resolveIterator } from "./pagination/index.js";
import type {
  FetchedPage,
  PageContext,
} from "./pagination/types.js";
import { withRetry } from "./retry.util.js";
import {
  applyTemplate,
  applyTemplateToConfig,
  type TemplateVariables,
} from "./template.util.js";
import {
  assertRecordsArray,
  buildUrl,
  walkRecordsPath,
} from "./rest-api.adapter.js";
import { applyTransform } from "./transform.util.js";

export async function fetchOnePage(
  endpoint: ApiEndpoint,
  baseUrl: string,
  auth: ApiAuthConfig,
  credentials: ApiCredentials | null,
  pagination: PaginationConfig,
  ctx: PageContext
): Promise<FetchedPage> {
  const vars: TemplateVariables = {
    cursor: ctx.cursor,
    pageNumber: ctx.pageNumber,
  };

  const paginationParams = ctx.overrideUrl !== undefined
    ? { query: {}, headers: {} }
    : paginationRequestParams(pagination, ctx);

  let baseRequestUrl: string;
  if (ctx.overrideUrl !== undefined) {
    // linkHeader: upstream provided the next URL verbatim; skip query
    // templating + pagination params on this request.
    baseRequestUrl = ctx.overrideUrl;
  } else {
    const templatedQuery = applyTemplateToConfig(
      (endpoint.config.queryParams as Record<string, string> | null | undefined) ?? undefined,
      vars
    );
    baseRequestUrl = buildUrl(baseUrl, endpoint.config.path, {
      ...templatedQuery,
      ...paginationParams.query,
    });
  }

  const templatedHeaders = applyTemplateToConfig(
    (endpoint.config.headers as Record<string, string> | null | undefined) ?? undefined,
    vars
  );
  const allHeaders = { ...templatedHeaders, ...paginationParams.headers };

  const body = endpoint.config.bodyTemplate
    ? applyTemplate(endpoint.config.bodyTemplate, vars)
    : undefined;

  const baseInit: RequestInit = {
    method: endpoint.config.method,
    ...(Object.keys(allHeaders).length > 0 ? { headers: allHeaders } : {}),
    ...(body !== undefined ? { body } : {}),
  };

  const { url, init } = applyAuth(baseRequestUrl, baseInit, auth, credentials);

  let result: FetchJsonResult;
  try {
    result = await withRetry(() => fetchJson(url, init));
  } catch (err) {
    throw remapAuthFailure(err, url);
  }

  // Records extraction: JSONata transform takes precedence when set
  // (decision 10 — mutually exclusive with recordsPath). Empty / unset
  // transform falls through to the recordsPath walker. Used by both
  // sync (errors throw normally) and probe (runProbePipeline catches
  // REST_API_TRANSFORM_FAILED and surfaces it as a degradation).
  const transform = endpoint.config.transform ?? "";
  let records: unknown[];
  if (transform.length > 0) {
    const transformed = await applyTransform(transform, result.body);
    if (transformed.error) {
      throw new ApiError(
        500,
        ApiCode.REST_API_TRANSFORM_FAILED,
        `JSONata transform ${transformed.error.kind} error: ${transformed.error.message}`,
        { kind: transformed.error.kind, message: transformed.error.message }
      );
    }
    records = transformed.records;
  } else {
    records = assertRecordsArray(
      walkRecordsPath(result.body, endpoint.config.recordsPath ?? ""),
      endpoint.config.recordsPath ?? ""
    );
  }

  return {
    body: result.body,
    headers: result.headers,
    status: result.status,
    records,
  };
}

/**
 * Drive the pagination iterator for exactly one page and return the
 * fetched payload. The iterator is fed the page so per-strategy
 * inspection runs (e.g. cursor extraction, Link header parsing) and
 * any config errors surface as throws; the second yield is discarded
 * because the caller only needs page 1.
 *
 * Used by `testConnection` (read-only dry run) and `discoverColumns`
 * (probe).
 */
export async function fetchFirstPage(
  endpoint: ApiEndpoint,
  baseUrl: string,
  auth: ApiAuthConfig,
  credentials: ApiCredentials | null,
  pagination: PaginationConfig
): Promise<FetchedPage> {
  const iterator = resolveIterator(pagination);
  const first = await iterator.next();
  if (first.done) {
    throw new ApiError(
      500,
      ApiCode.REST_API_OPERATION_FAILED,
      `Pagination iterator for "${pagination.strategy}" returned without yielding`,
      { strategy: pagination.strategy }
    );
  }

  const fetched = await fetchOnePage(
    endpoint,
    baseUrl,
    auth,
    credentials,
    pagination,
    first.value
  );

  // Feed the page back so the iterator runs its per-strategy response
  // inspection (cursor iterator throws REST_API_CURSOR_NOT_FOUND if
  // cursorResponsePath is missing on page 1, etc.). We discard the
  // second yield — the caller wants only page 1.
  await iterator.next(fetched);

  return fetched;
}

function paginationRequestParams(
  config: PaginationConfig,
  ctx: PageContext
): { query: Record<string, string>; headers: Record<string, string> } {
  switch (config.strategy) {
    case "none":
      return { query: {}, headers: {} };
    case "pageOffset": {
      const query: Record<string, string> = {
        [config.param]: String(ctx.pageNumber),
      };
      if (config.pageSizeParam) {
        query[config.pageSizeParam] = String(config.pageSize);
      }
      return { query, headers: {} };
    }
    case "cursor": {
      if (ctx.cursor === "") return { query: {}, headers: {} };
      if (config.cursorPlacement === "query") {
        return { query: { [config.cursorParam]: ctx.cursor }, headers: {} };
      }
      if (config.cursorPlacement === "header") {
        return { query: {}, headers: { [config.cursorParam]: ctx.cursor } };
      }
      // Body placement: user injects `{{cursor}}` through bodyTemplate.
      return { query: {}, headers: {} };
    }
    case "linkHeader":
      return { query: {}, headers: {} };
  }
}

/**
 * Project an upstream 401/403 into REST_API_AUTH_FAILED so the
 * frontend can distinguish credential errors from generic upstream
 * failures. All other fetch failures pass through unchanged.
 */
function remapAuthFailure(err: unknown, url: string): unknown {
  if (!(err instanceof ApiError)) return err;
  if (err.code !== ApiCode.REST_API_FETCH_FAILED) return err;
  const status = (err.details as { status?: number } | undefined)?.status;
  if (status === 401 || status === 403) {
    return new ApiError(
      502,
      ApiCode.REST_API_AUTH_FAILED,
      `Upstream rejected credentials (HTTP ${status})`,
      { url, status }
    );
  }
  return err;
}
