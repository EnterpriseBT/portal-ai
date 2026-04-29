/**
 * Orchestrates the Google Sheets OAuth callback into a `ConnectorInstance`.
 *
 * - Verifies the signed `state` token.
 * - Exchanges the auth code for a refresh token.
 * - Fetches the authenticated user's email (used as the account identity).
 * - Find-or-update the per-(org, googleAccountEmail) ConnectorInstance.
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-A.plan.md` §Slice 8.
 */

import {
  EMPTY_ACCOUNT_INFO,
  type PublicAccountInfo,
} from "@portalai/core/contracts";

import { ApiCode } from "../constants/api-codes.constants.js";
import { ApiError } from "./http.service.js";
import { DbService } from "./db.service.js";
import { GoogleAccessTokenCacheService } from "./google-access-token-cache.service.js";
import {
  GoogleAuthError,
  GoogleAuthService,
} from "./google-auth.service.js";
import { googleSheetsToWorkbook } from "./google-sheets-workbook.service.js";
import { WorkbookCacheService } from "./workbook-cache.service.js";
import { googleSheetsAdapter } from "../adapters/google-sheets/google-sheets.adapter.js";
import { environment } from "../environment.js";
import { decryptCredentials } from "../utils/crypto.util.js";
import {
  OAuthStateError,
  verifyState,
} from "../utils/oauth-state.util.js";
import { SystemUtilities } from "../utils/system.util.js";
import {
  findSheetById,
  inflateSheetPreview,
  sliceWorkbookRectangle,
  type PreviewSheet,
  type SliceQuery,
  type SliceResult,
} from "../utils/workbook-preview.util.js";

const DRIVE_FILES_LIST_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_PAGE_SIZE = 25;
const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const SHEETS_GET_URL_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

type FetchFn = typeof fetch;

/** Cache key prefix for the parsed workbook of a google-sheets instance. */
export function googleSheetsWorkbookCacheKey(
  connectorInstanceId: string
): string {
  return `gsheets:wb:${connectorInstanceId}`;
}

export interface SelectSheetInput {
  connectorInstanceId: string;
  spreadsheetId: string;
  organizationId: string;
  userId: string;
}

export interface SelectSheetResult {
  sheets: PreviewSheet[];
  sliced?: true;
}

export interface ListSheetsInput {
  connectorInstanceId: string;
  search?: string;
  pageToken?: string;
}

export interface ListSheetsItem {
  spreadsheetId: string;
  name: string;
  modifiedTime: string;
  ownerEmail: string | null;
}

export interface ListSheetsResult {
  items: ListSheetsItem[];
  nextPageToken?: string;
}

interface DriveFilesListResponse {
  files?: {
    id?: string;
    name?: string;
    modifiedTime?: string;
    owners?: { emailAddress?: string; displayName?: string }[];
  }[];
  nextPageToken?: string;
}

/**
 * Drive's `q` syntax escapes single-quote literals with a backslash.
 * Without this, a search term containing `'` (e.g. "O'Brien") corrupts
 * the query and Drive returns 400.
 */
function escapeForDriveQ(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

const GOOGLE_SHEETS_SLUG = "google-sheets";

export interface HandleCallbackInput {
  code: string;
  state: string;
}

export interface HandleCallbackResult {
  connectorInstanceId: string;
  accountInfo: PublicAccountInfo;
}

export class GoogleSheetsConnectorService {
  static async handleCallback(
    input: HandleCallbackInput
  ): Promise<HandleCallbackResult> {
    const { userId, organizationId } = verifyStateOrApiError(input.state);

    const tokens = await callExchangeOrApiError(input.code);
    const email = await callFetchEmailOrApiError(tokens.accessToken);

    const definition = await DbService.repository.connectorDefinitions.findBySlug(
      GOOGLE_SHEETS_SLUG
    );
    if (!definition) {
      throw new ApiError(
        500,
        ApiCode.GOOGLE_OAUTH_DEFINITION_NOT_FOUND,
        "google-sheets connector definition is not seeded"
      );
    }

    const credentials = {
      refresh_token: tokens.refreshToken,
      scopes: tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : [],
      googleAccountEmail: email,
    };

    const existing = await GoogleSheetsConnectorService.findByEmail(
      organizationId,
      definition.id,
      email
    );

    let connectorInstanceId: string;
    if (existing) {
      const updated = await DbService.repository.connectorInstances.update(
        existing.id,
        {
          credentials: credentials as unknown as string,
          updatedBy: userId,
        }
      );
      connectorInstanceId = updated?.id ?? existing.id;
    } else {
      const created = await DbService.repository.connectorInstances.create({
        id: SystemUtilities.id.v4.generate(),
        organizationId,
        connectorDefinitionId: definition.id,
        name: `Google Sheets (${email})`,
        status: "pending",
        config: null,
        credentials: credentials as unknown as string,
        lastSyncAt: null,
        lastErrorMessage: null,
        enabledCapabilityFlags: null,
        created: Date.now(),
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });
      connectorInstanceId = created.id;
    }

    const accountInfo =
      googleSheetsAdapter.toPublicAccountInfo?.(credentials) ??
      EMPTY_ACCOUNT_INFO;

    return { connectorInstanceId, accountInfo };
  }

  /**
   * Drive `files.list` proxy. Returns spreadsheets the authenticated
   * user can read, optionally filtered by name. Pagination via
   * `pageToken`. The slim response maps Drive's `id` → `spreadsheetId`
   * to match the connector's vocabulary.
   *
   * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-B.plan.md` §Slice 4.
   */
  static async listSheets(
    input: ListSheetsInput,
    fetchFn: FetchFn = fetch
  ): Promise<ListSheetsResult> {
    const accessToken = await GoogleAccessTokenCacheService.getOrRefresh(
      input.connectorInstanceId
    );

    let q = `mimeType='${SPREADSHEET_MIME_TYPE}' and trashed=false`;
    if (input.search && input.search.trim().length > 0) {
      q += ` and name contains '${escapeForDriveQ(input.search.trim())}'`;
    }

    const url = new URL(DRIVE_FILES_LIST_URL);
    url.searchParams.set("q", q);
    url.searchParams.set("pageSize", String(DRIVE_PAGE_SIZE));
    url.searchParams.set(
      "fields",
      "files(id,name,modifiedTime,owners(emailAddress,displayName)),nextPageToken"
    );
    if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);

    const res = await fetchFn(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const body = await safeReadText(res);
      throw new GoogleAuthError(
        "listSheets_failed",
        `Drive files.list failed (${res.status}): ${body}`
      );
    }

    const json = (await res.json()) as DriveFilesListResponse;
    const items: ListSheetsItem[] = (json.files ?? [])
      .filter((f) => typeof f.id === "string" && typeof f.name === "string")
      .map((f) => ({
        spreadsheetId: f.id as string,
        name: f.name as string,
        modifiedTime: f.modifiedTime ?? "",
        ownerEmail: f.owners?.[0]?.emailAddress ?? null,
      }));
    const result: ListSheetsResult = { items };
    if (json.nextPageToken) result.nextPageToken = json.nextPageToken;
    return result;
  }

  /**
   * Fetch a spreadsheet, map to `WorkbookData`, cache it, and update
   * the instance's `config` to record the selection. Returns the same
   * inline-or-sliced preview shape the file-upload `parseSession`
   * returns so the RegionEditor (Phase C) treats both pipelines the
   * same.
   *
   * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-B.plan.md` §Slice 7.
   */
  static async selectSheet(
    input: SelectSheetInput,
    fetchFn: FetchFn = fetch
  ): Promise<SelectSheetResult> {
    const accessToken = await GoogleAccessTokenCacheService.getOrRefresh(
      input.connectorInstanceId
    );

    // `fields` trims the response so we don't pull format metadata for
    // every cell unless it's date-format-specific. `includeGridData=true`
    // is required to receive cell values.
    const url = new URL(`${SHEETS_GET_URL_BASE}/${input.spreadsheetId}`);
    url.searchParams.set("includeGridData", "true");
    url.searchParams.set(
      "fields",
      "properties.title,sheets.properties(title,gridProperties),sheets.data(startRow,startColumn,rowData.values(userEnteredValue,effectiveValue,formattedValue,effectiveFormat.numberFormat))"
    );

    const res = await fetchFn(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await safeReadText(res);
      throw new GoogleAuthError(
        "fetchSheet_failed",
        `Sheets API spreadsheets.get failed (${res.status}): ${body}`
      );
    }

    const json = (await res.json()) as Record<string, unknown>;
    const workbook = googleSheetsToWorkbook(
      json as Parameters<typeof googleSheetsToWorkbook>[0]
    );
    const title =
      (json.properties as { title?: string } | undefined)?.title ??
      input.spreadsheetId;

    await WorkbookCacheService.set(
      googleSheetsWorkbookCacheKey(input.connectorInstanceId),
      workbook
    );

    await DbService.repository.connectorInstances.update(
      input.connectorInstanceId,
      {
        config: {
          spreadsheetId: input.spreadsheetId,
          title,
          fetchedAt: Date.now(),
        },
        updatedBy: input.userId,
      }
    );

    const inlineCellsMax = environment.FILE_UPLOAD_INLINE_CELLS_MAX;
    let sliced = false;
    const sheets: PreviewSheet[] = workbook.sheets.map((sheet, i) => {
      const inflated = inflateSheetPreview(sheet, i, inlineCellsMax);
      if (inflated.sliced) sliced = true;
      return inflated.sheet;
    });

    return sliced ? { sheets, sliced: true } : { sheets };
  }

  /**
   * Cell-rectangle endpoint backed by the cached `WorkbookData`. Same
   * contract as `FileUploadSessionService.sheetSlice` so the editor's
   * slice loader is pipeline-agnostic.
   *
   * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-B.plan.md` §Slice 8.
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
      googleSheetsWorkbookCacheKey(input.connectorInstanceId)
    );
    if (!workbook) {
      throw new ApiError(
        404,
        ApiCode.FILE_UPLOAD_SESSION_NOT_FOUND,
        `No cached workbook for instance ${input.connectorInstanceId} — call select-sheet first`
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
   * Linear scan over the org's google-sheets instances; decrypts each
   * credentials blob to match by email. O(N) — acceptable for v1 (one
   * human, 1–3 Google accounts). Promote to a dedicated repository
   * method when N becomes meaningful.
   */
  private static async findByEmail(
    organizationId: string,
    connectorDefinitionId: string,
    email: string
  ) {
    const instances =
      await DbService.repository.connectorInstances.findByOrgAndDefinition(
        organizationId,
        connectorDefinitionId
      );
    for (const instance of instances) {
      if (
        typeof instance.credentials === "object" &&
        instance.credentials !== null &&
        (instance.credentials as Record<string, unknown>).googleAccountEmail ===
          email
      ) {
        return instance;
      }
      // The repository's `findByOrgAndDefinition` already decrypts, so the
      // string-credentials branch shouldn't normally fire. Keep a fallback
      // for defensive coverage and to match other repository code paths.
      if (typeof instance.credentials === "string") {
        try {
          const decoded = decryptCredentials(instance.credentials);
          if (decoded.googleAccountEmail === email) return instance;
        } catch {
          /* skip rows with un-decryptable credentials */
        }
      }
    }
    return undefined;
  }
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
        ApiCode.GOOGLE_OAUTH_INVALID_STATE,
        `OAuth state ${err.kind}`
      );
    }
    throw err;
  }
}

async function callExchangeOrApiError(code: string) {
  try {
    return await GoogleAuthService.exchangeCode({ code });
  } catch (err) {
    if (err instanceof GoogleAuthError || (err as Error).name === "GoogleAuthError") {
      throw new ApiError(
        502,
        ApiCode.GOOGLE_OAUTH_EXCHANGE_FAILED,
        err instanceof Error ? err.message : "exchange failed"
      );
    }
    throw err;
  }
}

async function callFetchEmailOrApiError(accessToken: string): Promise<string> {
  try {
    return await GoogleAuthService.fetchUserEmail(accessToken);
  } catch (err) {
    if (err instanceof GoogleAuthError || (err as Error).name === "GoogleAuthError") {
      throw new ApiError(
        502,
        ApiCode.GOOGLE_OAUTH_USERINFO_FAILED,
        err instanceof Error ? err.message : "userinfo failed"
      );
    }
    throw err;
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
