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
import { makeWorkbook } from "@portalai/spreadsheet-parsing";
import type { Workbook, WorkbookData } from "@portalai/spreadsheet-parsing";

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
import { workbookCacheKey } from "../utils/connector-cache-keys.util.js";
import { decryptCredentials } from "../utils/crypto.util.js";
import {
  OAuthStateError,
  verifyState,
} from "../utils/oauth-state.util.js";
import { SystemUtilities } from "../utils/system.util.js";
import {
  findSheetMetaById,
  inflateSheetPreviewFromChunks,
  sheetId as makeSheetId,
  sliceSheetRectangleFromChunks,
  writeSheetDataToChunks,
  type PreviewSheet,
  type SliceQuery,
  type SliceResult,
} from "../utils/workbook-preview.util.js";
import { makeLazyWorkbookFromCache } from "../utils/lazy-workbook.util.js";

const DRIVE_FILES_LIST_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_PAGE_SIZE = 25;
const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const SHEETS_GET_URL_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

type FetchFn = typeof fetch;

export interface SelectSheetInput {
  connectorInstanceId: string;
  spreadsheetId: string;
  organizationId: string;
  userId: string;
}

export interface SelectSheetResult {
  title: string;
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
    const {
      userId,
      organizationId,
      connectorInstanceId: reconnectTargetId,
    } = verifyStateOrApiError(input.state);

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

    // Reconnect vs. new-connect: only the signed-state reconnect-target
    // path looks up an existing row. The "add connector" flow no longer
    // collapses onto a same-email row, so users can hold multiple
    // Google Sheets connectors against the same account (typically each
    // pointed at a different spreadsheet via select-sheet later).
    let connectorInstanceId: string;
    if (reconnectTargetId) {
      const target =
        await DbService.repository.connectorInstances.findById(reconnectTargetId);
      if (
        !target ||
        target.organizationId !== organizationId ||
        target.connectorDefinitionId !== definition.id
      ) {
        throw new ApiError(
          404,
          ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
          "Reconnect target not found for this organization"
        );
      }
      // Phase E reconnect: reset status + clear lastErrorMessage so an
      // instance that was flipped to `error` by the access-token cache
      // (on `invalid_grant`) returns to `active` once Google has issued
      // fresh credentials. Without this, the user reconnects but the UI
      // keeps showing the error chip and the Sync button stays disabled.
      const updated = await DbService.repository.connectorInstances.update(
        target.id,
        {
          credentials: credentials as unknown as string,
          status: "active",
          lastErrorMessage: null,
          updatedBy: userId,
        }
      );
      connectorInstanceId = updated?.id ?? target.id;
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
        // Inherit the definition's capability ceiling by default — the
        // user can narrow specific flags later via PATCH.
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

    const { workbook, title: rawTitle } = await fetchSpreadsheet(
      accessToken,
      input.spreadsheetId,
      fetchFn
    );
    const title = rawTitle ?? input.spreadsheetId;

    // Stream the mapped workbook into the chunked cache so slice/preview/
    // resolveWorkbook share one layout across every pipeline (file-upload,
    // google-sheets, microsoft-excel). Sheet ids match what the file-upload
    // pipeline mints so the editor's slice loader is pipeline-agnostic.
    const prefix = workbookCacheKey(GOOGLE_SHEETS_SLUG, input.connectorInstanceId);
    // Best-effort cleanup of any prior session under this key before
    // overwriting; the cache TTL would handle this eventually but a fresh
    // selection should not see ghost rows from a previous workbook.
    await WorkbookCacheService.deleteSession(prefix);
    const writer = await WorkbookCacheService.beginSession(prefix);
    try {
      for (let i = 0; i < workbook.sheets.length; i++) {
        const sheet = workbook.sheets[i]!;
        const sheetId = makeSheetId(i, sheet.name);
        const stats = await writeSheetDataToChunks(sheet, sheetId, writer);
        await writer.finishSheet(sheetId, {
          name: sheet.name,
          rowCount: stats.rowCount,
          colCount: stats.colCount,
          merges: stats.merges,
        });
      }
      await writer.finalize("ready");
    } catch (err) {
      await writer.fail(err instanceof Error ? err.message : "transcribe failed");
      void WorkbookCacheService.deleteSession(prefix).catch(() => {});
      throw err;
    }

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
    const meta = await WorkbookCacheService.getSessionMeta(prefix);
    if (!meta) {
      throw new ApiError(
        500,
        ApiCode.GOOGLE_SHEETS_INVALID_PAYLOAD,
        "Session meta missing after finalize"
      );
    }
    let sliced = false;
    const sheets: PreviewSheet[] = [];
    for (const sheetMeta of meta.sheets) {
      const inflated = await inflateSheetPreviewFromChunks(
        prefix,
        sheetMeta,
        inlineCellsMax
      );
      if (inflated.sliced) sliced = true;
      sheets.push(inflated.sheet);
    }

    return sliced ? { title, sheets, sliced: true } : { title, sheets };
  }

  /**
   * Rebuild the chunked workbook cache for an existing connector
   * instance from Google directly. Used by the edit-layout-plan
   * endpoint when the cache has lapsed (TTL is 1h; `selectSheet`
   * populates it but doesn't refresh it). Sync is unaffected because
   * sync calls `fetchWorkbookForSync` and skips the cache entirely;
   * the editor needs the cache because the slice loader on the
   * frontend serves cells from there.
   *
   * Reads `spreadsheetId` from the instance's persisted `config` — the
   * same source `fetchWorkbookForSync` uses — and does NOT update the
   * config (the spreadsheet selection isn't changing, only the cache
   * is being repopulated).
   *
   * Throws `GoogleAuthError` on token-refresh failure (auth UI handles
   * it the same way it does for sync) and `GOOGLE_SHEETS_INVALID_PAYLOAD`
   * when the instance has never had a sheet picked.
   */
  static async rehydrateWorkbookCache(
    connectorInstanceId: string,
    organizationId: string,
    fetchFn: FetchFn = fetch
  ): Promise<void> {
    const instance =
      await DbService.repository.connectorInstances.findById(
        connectorInstanceId
      );
    if (!instance || instance.organizationId !== organizationId) {
      throw new ApiError(
        404,
        ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
        `Connector instance not found: ${connectorInstanceId}`
      );
    }
    const cfg = instance.config as
      | { spreadsheetId?: string }
      | null
      | undefined;
    const spreadsheetId = cfg?.spreadsheetId;
    if (!spreadsheetId) {
      throw new ApiError(
        400,
        ApiCode.GOOGLE_SHEETS_INVALID_PAYLOAD,
        `Instance ${connectorInstanceId} has no spreadsheetId in config — call select-sheet first`
      );
    }
    const accessToken =
      await GoogleAccessTokenCacheService.getOrRefresh(connectorInstanceId);
    const { workbook } = await fetchSpreadsheet(
      accessToken,
      spreadsheetId,
      fetchFn
    );
    const prefix = workbookCacheKey(GOOGLE_SHEETS_SLUG, connectorInstanceId);
    // Wipe any prior session (probably expired anyway) before
    // overwriting, so a stale chunk from a previous selection can't
    // leak into the new one.
    await WorkbookCacheService.deleteSession(prefix);
    const writer = await WorkbookCacheService.beginSession(prefix);
    try {
      for (let i = 0; i < workbook.sheets.length; i++) {
        const sheet = workbook.sheets[i]!;
        const sheetId = makeSheetId(i, sheet.name);
        const stats = await writeSheetDataToChunks(sheet, sheetId, writer);
        await writer.finishSheet(sheetId, {
          name: sheet.name,
          rowCount: stats.rowCount,
          colCount: stats.colCount,
          merges: stats.merges,
        });
      }
      await writer.finalize("ready");
    } catch (err) {
      await writer.fail(err instanceof Error ? err.message : "rehydrate failed");
      void WorkbookCacheService.deleteSession(prefix).catch(() => {});
      throw err;
    }
  }

  /**
   * Re-fetch the spreadsheet for an existing connector instance and
   * return the mapped `WorkbookData`. Phase D's sync path calls this
   * (the editor session uses `selectSheet` instead, which also caches).
   *
   * Reads `spreadsheetId` from the instance's persisted `config` —
   * sync runs against whichever spreadsheet was last picked, not a
   * caller-supplied id. Does **not** write to the workbook cache:
   * sync wants fresh Google data on every run, and the cache is
   * scoped to the interactive editor session.
   *
   * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-D.plan.md` §Slice 3.
   */
  static async fetchWorkbookForSync(
    connectorInstanceId: string,
    organizationId: string,
    fetchFn: FetchFn = fetch
  ): Promise<Workbook> {
    const instance =
      await DbService.repository.connectorInstances.findById(
        connectorInstanceId
      );
    if (!instance) {
      throw new ApiError(
        404,
        ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
        `Connector instance not found: ${connectorInstanceId}`
      );
    }
    if (instance.organizationId !== organizationId) {
      throw new ApiError(
        403,
        ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
        "Connector instance belongs to a different organization"
      );
    }
    const cfg = instance.config as
      | { spreadsheetId?: string }
      | null
      | undefined;
    const spreadsheetId = cfg?.spreadsheetId;
    if (!spreadsheetId) {
      throw new ApiError(
        400,
        ApiCode.GOOGLE_SHEETS_INVALID_PAYLOAD,
        `Instance ${connectorInstanceId} has no spreadsheetId in config — call select-sheet first`
      );
    }

    const accessToken = await GoogleAccessTokenCacheService.getOrRefresh(
      connectorInstanceId
    );
    const { workbook } = await fetchSpreadsheet(
      accessToken,
      spreadsheetId,
      fetchFn
    );
    // The Sheets API mapper already produces a fully-resolved
    // `WorkbookData`; wrap it in an eager `Workbook` for downstream
    // consumers. Sync's memory ceiling is bounded by Google Sheets'
    // own API limits, not the chunked cache.
    return makeWorkbook(workbook);
  }

  /**
   * Resolve the cached `WorkbookData` for a google-sheets pending
   * instance. Mirrors `FileUploadSessionService.resolveWorkbook` so the
   * layout-plan-draft service can dispatch by connectorInstanceId.
   *
   * Cache miss is fatal here — there's no S3 fallback like file-upload
   * has, and re-fetching the spreadsheet would burn Drive API quota
   * silently. The caller (frontend workflow) is expected to re-call
   * `selectSheet` when the cache TTL has elapsed; that's also where the
   * cache TTL collision handling described in the discovery doc lives.
   */
  static async resolveWorkbook(
    connectorInstanceId: string,
    organizationId: string
  ): Promise<Workbook> {
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
    const prefix = workbookCacheKey(GOOGLE_SHEETS_SLUG, connectorInstanceId);
    const meta = await WorkbookCacheService.getSessionMeta(prefix);
    if (!meta || meta.status !== "ready") {
      throw new ApiError(
        404,
        ApiCode.FILE_UPLOAD_SESSION_NOT_FOUND,
        `No cached workbook for instance ${connectorInstanceId} — call select-sheet first`
      );
    }
    return makeLazyWorkbookFromCache(prefix, meta.sheets);
  }

  /**
   * Cell-rectangle endpoint backed by the chunked workbook cache. Same
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
    const prefix = workbookCacheKey(
      GOOGLE_SHEETS_SLUG,
      input.connectorInstanceId
    );
    const meta = await WorkbookCacheService.getSessionMeta(prefix);
    if (!meta || meta.status !== "ready") {
      throw new ApiError(
        404,
        ApiCode.FILE_UPLOAD_SESSION_NOT_FOUND,
        `No cached workbook for instance ${input.connectorInstanceId} — call select-sheet first`
      );
    }
    const sheetMeta = findSheetMetaById(meta, input.sheetId);
    if (!sheetMeta) {
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
    return sliceSheetRectangleFromChunks(prefix, sheetMeta, query);
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
  connectorInstanceId?: string;
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

/**
 * Hit `spreadsheets.get?includeGridData=true` for the given
 * spreadsheetId and return the mapped `WorkbookData` plus the workbook's
 * title from `properties.title`. Shared by `selectSheet` (caches the
 * workbook + persists the title to instance.config) and
 * `fetchWorkbookForSync` (does neither — sync uses fresh data each run).
 */
async function fetchSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  fetchFn: typeof fetch
): Promise<{ workbook: WorkbookData; title: string | undefined }> {
  // `fields` trims the response so we don't pull format metadata for
  // every cell unless it's date-format-specific. `includeGridData=true`
  // is required to receive cell values.
  const url = new URL(`${SHEETS_GET_URL_BASE}/${spreadsheetId}`);
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
  const title = (json.properties as { title?: string } | undefined)?.title;
  return { workbook, title };
}
