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
import type { FetchedPage, PageContext } from "./pagination/types.js";
import { withRetry } from "./retry.util.js";
import { streamFetchRecords, type StreamFetchResult } from "./stream.util.js";
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
  ctx: PageContext,
  options: { skipRecordsExtraction?: boolean } = {}
): Promise<FetchedPage> {
  const vars: TemplateVariables = {
    cursor: ctx.cursor,
    pageNumber: ctx.pageNumber,
  };

  const paginationParams =
    ctx.overrideUrl !== undefined
      ? { query: {}, headers: {} }
      : paginationRequestParams(pagination, ctx);

  let baseRequestUrl: string;
  if (ctx.overrideUrl !== undefined) {
    // linkHeader: upstream provided the next URL verbatim; skip query
    // templating + pagination params on this request.
    baseRequestUrl = ctx.overrideUrl;
  } else {
    const templatedQuery = applyTemplateToConfig(
      (endpoint.config.queryParams as
        | Record<string, string>
        | null
        | undefined) ?? undefined,
      vars
    );
    baseRequestUrl = buildUrl(baseUrl, endpoint.config.path, {
      ...templatedQuery,
      ...paginationParams.query,
    });
  }

  const templatedHeaders = applyTemplateToConfig(
    (endpoint.config.headers as Record<string, string> | null | undefined) ??
      undefined,
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
  //
  // Preview callers pass `skipRecordsExtraction: true` so the upstream
  // body can be returned verbatim — they apply records-path / JSONata
  // client-side against the rendered JSON and surface errors inline,
  // independent of whether the body is shaped like a records array.
  const transform = endpoint.config.transform ?? "";
  let records: unknown[];
  if (options.skipRecordsExtraction) {
    records = [];
  } else if (transform.length > 0) {
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
  pagination: PaginationConfig,
  options: { skipRecordsExtraction?: boolean } = {}
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
    first.value,
    options
  );

  // For preview we skip the iterator's response-inspection feedback —
  // the cursor iterator throws REST_API_CURSOR_NOT_FOUND when the
  // configured path is missing, which would fail a preview against an
  // endpoint the user is still mid-configuring.
  if (!options.skipRecordsExtraction) {
    await iterator.next(fetched);
  }

  return fetched;
}

/**
 * Streaming counterpart to `fetchOnePage` for the unpaginated +
 * recordsPath case. Mirrors the URL / template / header / body / auth
 * plumbing so the records hot path stays config-identical to the
 * buffered path; the only difference is that records arrive
 * incrementally via the returned `recordsStream` instead of as a
 * materialized array.
 *
 * Restricted to `pagination: "none"` by construction — callers ensure
 * eligibility via `isStreamingEligible` (wired into `syncInstance` in
 * slice 4). Throws `REST_API_INVALID_CONFIG` if `recordsPath` is empty
 * while `transform` is set, since the streaming path doesn't run
 * JSONata.
 *
 * `withRetry` wraps only the initial fetch — the streaming read is
 * single-attempt by design. Mid-stream failures fail the sync the same
 * way a mid-buffered-page failure does today (no resumable streaming
 * — out of scope per the spec).
 */
export async function streamFetchOnePage(
  endpoint: ApiEndpoint,
  baseUrl: string,
  auth: ApiAuthConfig,
  credentials: ApiCredentials | null
): Promise<StreamFetchResult> {
  const recordsPath = endpoint.config.recordsPath ?? "";
  const transform = (endpoint.config.transform ?? "").trim();

  if (recordsPath === "" && transform.length > 0) {
    throw new ApiError(
      500,
      ApiCode.REST_API_INVALID_CONFIG,
      "streamFetchOnePage does not run JSONata transforms; route through fetchOnePage instead",
      { recordsPath, transformLength: transform.length }
    );
  }

  // Page-1 defaults — the eligibility predicate guarantees pagination
  // is "none", so there's no cursor / offset to template.
  const vars: TemplateVariables = { cursor: "", pageNumber: 1 };

  const templatedQuery = applyTemplateToConfig(
    (endpoint.config.queryParams as
      | Record<string, string>
      | null
      | undefined) ?? undefined,
    vars
  );
  const baseRequestUrl = buildUrl(
    baseUrl,
    endpoint.config.path,
    templatedQuery
  );

  const templatedHeaders = applyTemplateToConfig(
    (endpoint.config.headers as Record<string, string> | null | undefined) ??
      undefined,
    vars
  );

  const body = endpoint.config.bodyTemplate
    ? applyTemplate(endpoint.config.bodyTemplate, vars)
    : undefined;

  const baseInit: RequestInit = {
    method: endpoint.config.method,
    ...(Object.keys(templatedHeaders).length > 0
      ? { headers: templatedHeaders }
      : {}),
    ...(body !== undefined ? { body } : {}),
  };

  const { url, init } = applyAuth(baseRequestUrl, baseInit, auth, credentials);

  try {
    return await withRetry(() => streamFetchRecords(url, init, recordsPath));
  } catch (err) {
    throw remapAuthFailure(err, url);
  }
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
    case "linkBody":
      // Next URL comes from the response body; subsequent requests
      // use `overrideUrl` so query/header injection is bypassed.
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
