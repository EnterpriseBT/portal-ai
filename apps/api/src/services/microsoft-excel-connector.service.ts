/**
 * Orchestrates the Microsoft 365 Excel OAuth callback into a
 * `ConnectorInstance`. Phase A scope:
 *
 *   - Verifies the signed `state` token.
 *   - Exchanges the auth code for refresh + access + id tokens.
 *   - Decodes the id_token's `tid` claim to scope the instance to a
 *     specific Microsoft tenant. Personal MSAs use the well-known
 *     personal tenant id `9188040d-6c67-4c5b-b112-36a304b66dad`.
 *   - Fetches Graph /me for UPN, email, displayName.
 *   - Find-or-update the per-(org, tenantId, microsoftAccountUpn)
 *     ConnectorInstance. The tenantId discriminator is what keeps a
 *     personal MSA and a work account that happen to share an email
 *     alias as **separate** instances.
 *
 * Phases B/D add `searchWorkbooks`, `selectWorkbook`, `sheetSlice`,
 * `resolveWorkbook`, and `fetchWorkbookForSync`.
 */

import type { PublicAccountInfo } from "@portalai/core/contracts";
import type { WorkbookData } from "@portalai/spreadsheet-parsing";

import { ApiCode } from "../constants/api-codes.constants.js";
import { ApiError } from "./http.service.js";
import { DbService } from "./db.service.js";
import { MicrosoftAccessTokenCacheService } from "./microsoft-access-token-cache.service.js";
import {
  MicrosoftAuthError,
  MicrosoftAuthService,
  type MicrosoftUserProfile,
  type TokenBundle,
} from "./microsoft-auth.service.js";
import {
  MicrosoftGraphError,
  MicrosoftGraphService,
  type MicrosoftGraphWorkbookListItem,
} from "./microsoft-graph.service.js";
import { WorkbookCacheService } from "./workbook-cache.service.js";
import { xlsxToWorkbook } from "./workbook-adapters/xlsx.adapter.js";
import { environment } from "../environment.js";
import { workbookCacheKey } from "../utils/connector-cache-keys.util.js";
import { decryptCredentials } from "../utils/crypto.util.js";
import {
  OAuthStateError,
  verifyState,
} from "../utils/oauth-state.util.js";
import { SystemUtilities } from "../utils/system.util.js";
import { createLogger } from "../utils/logger.util.js";
import {
  findSheetById,
  inflateSheetPreview,
  sliceWorkbookRectangle,
  type PreviewSheet,
  type SliceQuery,
  type SliceResult,
} from "../utils/workbook-preview.util.js";

const logger = createLogger({ module: "microsoft-excel-connector" });

const MICROSOFT_EXCEL_SLUG = "microsoft-excel";

export interface HandleCallbackInput {
  code: string;
  state: string;
}

export interface HandleCallbackResult {
  connectorInstanceId: string;
  accountInfo: PublicAccountInfo;
}

export interface SearchWorkbooksInput {
  connectorInstanceId: string;
  search?: string;
}

export interface SearchWorkbooksResult {
  items: MicrosoftGraphWorkbookListItem[];
}

export interface SelectWorkbookInput {
  connectorInstanceId: string;
  driveItemId: string;
  organizationId: string;
  userId: string;
}

export interface SelectWorkbookResult {
  title: string;
  sheets: PreviewSheet[];
  sliced?: true;
}

function buildAccountInfo(profile: MicrosoftUserProfile): PublicAccountInfo {
  // PublicAccountInfo.metadata only accepts primitive values (string |
  // number | boolean). Personal MSAs have `email: null` — drop the key
  // entirely in that case rather than emit a null value.
  const metadata: Record<string, string | number | boolean> = {
    displayName: profile.displayName,
    tenantId: profile.tenantId,
  };
  if (profile.email) metadata.email = profile.email;
  return { identity: profile.upn, metadata };
}

export class MicrosoftExcelConnectorService {
  static async handleCallback(
    input: HandleCallbackInput
  ): Promise<HandleCallbackResult> {
    const { userId, organizationId } = verifyStateOrApiError(input.state);

    const tokens = await callExchangeOrApiError(input.code);
    const tenantId = decodeTenantIdFromIdToken(tokens.idToken);
    const profile = await callFetchProfileOrApiError(tokens.accessToken, tenantId);

    const definition = await DbService.repository.connectorDefinitions.findBySlug(
      MICROSOFT_EXCEL_SLUG
    );
    if (!definition) {
      throw new ApiError(
        500,
        ApiCode.MICROSOFT_OAUTH_DEFINITION_NOT_FOUND,
        "microsoft-excel connector definition is not seeded"
      );
    }

    const credentials = {
      refresh_token: tokens.refreshToken,
      scopes: tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : [],
      microsoftAccountUpn: profile.upn,
      microsoftAccountEmail: profile.email,
      microsoftAccountDisplayName: profile.displayName,
      tenantId: profile.tenantId,
      lastRefreshedAt: Date.now(),
    };

    const existing = await MicrosoftExcelConnectorService.findByTenantAndUpn(
      organizationId,
      definition.id,
      profile.tenantId,
      profile.upn
    );

    let connectorInstanceId: string;
    if (existing) {
      // Phase E reconnect path — reset status + clear lastErrorMessage
      // so an instance previously flipped to `error` by the access-token
      // cache returns to `active` once Microsoft has issued fresh
      // credentials.
      const updated = await DbService.repository.connectorInstances.update(
        existing.id,
        {
          credentials: credentials as unknown as string,
          status: "active",
          lastErrorMessage: null,
          updatedBy: userId,
        }
      );
      connectorInstanceId = updated?.id ?? existing.id;
    } else {
      const created = await DbService.repository.connectorInstances.create({
        id: SystemUtilities.id.v4.generate(),
        organizationId,
        connectorDefinitionId: definition.id,
        name: `Microsoft 365 Excel (${profile.upn})`,
        status: "pending",
        config: null,
        credentials: credentials as unknown as string,
        lastSyncAt: null,
        lastErrorMessage: null,
        enabledCapabilityFlags: { ...definition.capabilityFlags },
        created: Date.now(),
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });
      connectorInstanceId = created.id;
    }

    logger.info(
      {
        connectorInstanceId,
        organizationId,
        tenantId: profile.tenantId,
        upn: profile.upn,
      },
      "microsoft-excel OAuth callback completed"
    );

    return {
      connectorInstanceId,
      accountInfo: buildAccountInfo(profile),
    };
  }

  /**
   * List the user's `.xlsx` workbooks. Empty `search` returns the
   * recently-modified set; non-empty hits Graph search with `q=`. The
   * graph service post-filters to `.xlsx` mime + extension; this
   * method only marshals the auth + result shape.
   */
  static async searchWorkbooks(
    input: SearchWorkbooksInput
  ): Promise<SearchWorkbooksResult> {
    const accessToken = await MicrosoftAccessTokenCacheService.getOrRefresh(
      input.connectorInstanceId
    );
    const items = await MicrosoftGraphService.searchWorkbooks(
      accessToken,
      input.search ?? ""
    );
    return { items };
  }

  /**
   * Pre-flight (size + extension), download, parse, cache, and update
   * `instance.config`. Returns the same inline-or-sliced preview shape
   * the file-upload `parseSession` returns so the RegionEditor (Phase
   * C) treats both pipelines the same.
   *
   * The size check uses Graph's lightweight metadata endpoint BEFORE
   * the content download — an oversized workbook is refused with a
   * clean `MICROSOFT_EXCEL_FILE_TOO_LARGE` (status 413) without ever
   * draining bytes through the API process. The extension check is
   * also pre-download.
   */
  static async selectWorkbook(
    input: SelectWorkbookInput
  ): Promise<SelectWorkbookResult> {
    const accessToken = await MicrosoftAccessTokenCacheService.getOrRefresh(
      input.connectorInstanceId
    );

    const head = await MicrosoftGraphService.headWorkbook(
      accessToken,
      input.driveItemId
    );

    const cap = environment.UPLOAD_MAX_FILE_SIZE_BYTES;
    if (head.size > cap) {
      throw new ApiError(
        413,
        ApiCode.MICROSOFT_EXCEL_FILE_TOO_LARGE,
        `Workbook exceeds the configured byte cap (${head.size} > ${cap})`,
        { sizeBytes: head.size, capBytes: cap }
      );
    }

    if (!head.name.toLowerCase().endsWith(".xlsx")) {
      throw new ApiError(
        415,
        ApiCode.MICROSOFT_EXCEL_UNSUPPORTED_FORMAT,
        `Only .xlsx workbooks are supported (got "${head.name}")`
      );
    }

    let download;
    try {
      download = await MicrosoftGraphService.downloadWorkbook(
        accessToken,
        input.driveItemId
      );
    } catch (err) {
      throw mapGraphError(err);
    }

    const nodeStream = MicrosoftGraphService.toNodeReadable(download.stream);
    const workbook = await xlsxToWorkbook(nodeStream);

    await WorkbookCacheService.set(
      workbookCacheKey(MICROSOFT_EXCEL_SLUG, input.connectorInstanceId),
      workbook
    );

    await DbService.repository.connectorInstances.update(
      input.connectorInstanceId,
      {
        config: {
          driveItemId: input.driveItemId,
          name: head.name,
          fetchedAt: Date.now(),
        },
        updatedBy: input.userId,
      }
    );

    const title = stripXlsxExtension(head.name);
    const inlineCellsMax = environment.FILE_UPLOAD_INLINE_CELLS_MAX;
    let sliced = false;
    const sheets: PreviewSheet[] = workbook.sheets.map((sheet, i) => {
      const inflated = inflateSheetPreview(sheet, i, inlineCellsMax);
      if (inflated.sliced) sliced = true;
      return inflated.sheet;
    });

    return sliced ? { title, sheets, sliced: true } : { title, sheets };
  }

  /**
   * Cell-rectangle endpoint backed by the cached `WorkbookData`. Cache
   * miss is fatal — the editor session is responsible for re-calling
   * `selectWorkbook` to refill the cache after TTL.
   */
  static async sheetSlice(input: {
    connectorInstanceId: string;
    sheetId: string;
    rowStart: number;
    rowEnd: number;
    colStart: number;
    colEnd: number;
  }): Promise<SliceResult> {
    const workbook = await WorkbookCacheService.get(
      workbookCacheKey(MICROSOFT_EXCEL_SLUG, input.connectorInstanceId)
    );
    if (!workbook) {
      throw new ApiError(
        404,
        ApiCode.FILE_UPLOAD_SESSION_NOT_FOUND,
        `No cached workbook for instance ${input.connectorInstanceId} — call select-workbook first`
      );
    }
    const match = findSheetById(workbook, input.sheetId);
    if (!match) {
      throw new ApiError(
        404,
        ApiCode.FILE_UPLOAD_SLICE_OUT_OF_BOUNDS,
        `Sheet ${input.sheetId} not present in workbook`
      );
    }
    const query: SliceQuery = {
      rowStart: input.rowStart,
      rowEnd: input.rowEnd,
      colStart: input.colStart,
      colEnd: input.colEnd,
    };
    return sliceWorkbookRectangle(match.sheet, query);
  }

  /**
   * Resolve the cached `WorkbookData` for the layout-plan-draft
   * dispatcher. Mirrors `GoogleSheetsConnectorService.resolveWorkbook`
   * — cache miss is fatal, no S3 fallback (sync uses
   * `fetchWorkbookForSync` instead, landed in Phase D).
   */
  static async resolveWorkbook(
    connectorInstanceId: string,
    organizationId: string
  ): Promise<WorkbookData> {
    const instance =
      await DbService.repository.connectorInstances.findById(
        connectorInstanceId
      );
    if (!instance) {
      throw new ApiError(
        404,
        ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
        `Connector instance ${connectorInstanceId} not found`
      );
    }
    if (instance.organizationId !== organizationId) {
      throw new ApiError(
        403,
        ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
        "Connector instance belongs to a different organization"
      );
    }
    const cached = await WorkbookCacheService.get(
      workbookCacheKey(MICROSOFT_EXCEL_SLUG, connectorInstanceId)
    );
    if (!cached) {
      throw new ApiError(
        404,
        ApiCode.FILE_UPLOAD_SESSION_NOT_FOUND,
        `No cached workbook for instance ${connectorInstanceId} — call select-workbook first`
      );
    }
    return cached;
  }

  /**
   * Linear scan over the org's microsoft-excel instances; matches by
   * `(tenantId, microsoftAccountUpn)`. O(N) — acceptable for v1 (one
   * human, 1–3 Microsoft accounts). Promote to a dedicated repository
   * method when N becomes meaningful.
   */
  private static async findByTenantAndUpn(
    organizationId: string,
    connectorDefinitionId: string,
    tenantId: string,
    upn: string
  ) {
    const instances =
      await DbService.repository.connectorInstances.findByOrgAndDefinition(
        organizationId,
        connectorDefinitionId
      );
    for (const instance of instances) {
      const credentials = readCredentialsObject(instance.credentials);
      if (!credentials) continue;
      if (
        credentials.microsoftAccountUpn === upn &&
        credentials.tenantId === tenantId
      ) {
        return instance;
      }
    }
    return undefined;
  }
}

function stripXlsxExtension(name: string): string {
  return name.replace(/\.xlsx$/i, "");
}

function mapGraphError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (
    err instanceof MicrosoftGraphError ||
    (err as Error)?.name === "MicrosoftGraphError"
  ) {
    const kind = (err as MicrosoftGraphError).kind;
    const message = (err as Error).message;
    const details = (err as MicrosoftGraphError).details;
    switch (kind) {
      case "file_too_large":
        return new ApiError(
          413,
          ApiCode.MICROSOFT_EXCEL_FILE_TOO_LARGE,
          message,
          details
        );
      case "search_failed":
        return new ApiError(
          502,
          ApiCode.MICROSOFT_EXCEL_LIST_FAILED,
          message
        );
      case "head_failed":
      case "download_failed":
        return new ApiError(
          502,
          ApiCode.MICROSOFT_EXCEL_FETCH_FAILED,
          message
        );
      default:
        return new ApiError(
          502,
          ApiCode.MICROSOFT_EXCEL_FETCH_FAILED,
          message
        );
    }
  }
  return new ApiError(
    500,
    ApiCode.MICROSOFT_EXCEL_FETCH_FAILED,
    err instanceof Error ? err.message : "Unknown error"
  );
}

function readCredentialsObject(
  value: unknown
): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      return decryptCredentials(value) as unknown as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Decode the `tid` claim from a Microsoft id_token (a standard JWT).
 * We only read the payload; signature verification is the token
 * endpoint's responsibility — by the time we hold this token we've
 * already validated against Microsoft over TLS.
 */
function decodeTenantIdFromIdToken(idToken: string): string {
  if (!idToken) {
    throw new ApiError(
      502,
      ApiCode.MICROSOFT_OAUTH_EXCHANGE_FAILED,
      "Microsoft id_token missing — cannot scope instance to tenant"
    );
  }
  const parts = idToken.split(".");
  if (parts.length < 2 || !parts[1]) {
    throw new ApiError(
      502,
      ApiCode.MICROSOFT_OAUTH_EXCHANGE_FAILED,
      "Microsoft id_token is malformed"
    );
  }
  let claims: Record<string, unknown>;
  try {
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    claims = JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    throw new ApiError(
      502,
      ApiCode.MICROSOFT_OAUTH_EXCHANGE_FAILED,
      "Microsoft id_token payload is not valid JSON"
    );
  }
  const tid = claims.tid;
  if (typeof tid !== "string" || tid.length === 0) {
    throw new ApiError(
      502,
      ApiCode.MICROSOFT_OAUTH_EXCHANGE_FAILED,
      "Microsoft id_token is missing the `tid` (tenant id) claim"
    );
  }
  return tid;
}

function verifyStateOrApiError(token: string): {
  userId: string;
  organizationId: string;
} {
  try {
    return verifyState(token);
  } catch (err) {
    if (err instanceof OAuthStateError) {
      throw new ApiError(
        400,
        ApiCode.MICROSOFT_OAUTH_INVALID_STATE,
        `OAuth state ${err.kind}`
      );
    }
    throw err;
  }
}

async function callExchangeOrApiError(code: string): Promise<TokenBundle> {
  try {
    return await MicrosoftAuthService.exchangeCode({ code });
  } catch (err) {
    if (
      err instanceof MicrosoftAuthError ||
      (err as Error)?.name === "MicrosoftAuthError"
    ) {
      const kind = (err as MicrosoftAuthError).kind;
      const message = err instanceof Error ? err.message : "exchange failed";
      if (kind === "no_refresh_token") {
        throw new ApiError(
          502,
          ApiCode.MICROSOFT_OAUTH_NO_REFRESH_TOKEN,
          message
        );
      }
      throw new ApiError(
        502,
        ApiCode.MICROSOFT_OAUTH_EXCHANGE_FAILED,
        message
      );
    }
    throw err;
  }
}

async function callFetchProfileOrApiError(
  accessToken: string,
  tenantId: string
): Promise<MicrosoftUserProfile> {
  try {
    return await MicrosoftAuthService.fetchUserProfile(accessToken, tenantId);
  } catch (err) {
    if (
      err instanceof MicrosoftAuthError ||
      (err as Error)?.name === "MicrosoftAuthError"
    ) {
      throw new ApiError(
        502,
        ApiCode.MICROSOFT_OAUTH_USERINFO_FAILED,
        err instanceof Error ? err.message : "userinfo failed"
      );
    }
    throw err;
  }
}
