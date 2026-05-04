/**
 * Google Sheets connector — frontend SDK.
 *
 * Five surfaces:
 *   - `authorize` — POST to mint the consent URL the popup hook opens.
 *   - `searchSheets` — imperative GET against Drive's files.list proxy.
 *   - `selectSheet` — POST to fetch + cache the chosen workbook server-side.
 *   - `sheetSlice` — imperative GET for cell rectangles on big sheets;
 *     plugged into RegionEditor's `loadSlice` callback at the workflow
 *     level (per `feedback_sdk_helpers_for_api`, never via `fetch`).
 *
 * The OAuth callback HTML returns directly to the user's browser via
 * Google's redirect; that path doesn't go through the SDK — the popup
 * hook (`useOAuthPopupAuthorize`) listens for the postMessage instead.
 */

import type {
  GoogleSheetsAuthorizeResponsePayload,
  GoogleSheetsListSheetsRequestQuery,
  GoogleSheetsListSheetsResponsePayload,
  GoogleSheetsSelectSheetRequest,
  GoogleSheetsSelectSheetResponsePayload,
  GoogleSheetsSheetSliceRequest,
  GoogleSheetsSheetSliceResponsePayload,
} from "@portalai/core/contracts";

import { useAuthMutation } from "../utils/api.util";

export const googleSheets = {
  authorize: () =>
    useAuthMutation<GoogleSheetsAuthorizeResponsePayload, void>({
      url: "/api/connectors/google-sheets/authorize",
    }),

  searchSheets: () =>
    useAuthMutation<
      GoogleSheetsListSheetsResponsePayload,
      GoogleSheetsListSheetsRequestQuery
    >({
      url: (vars) => {
        const params = new URLSearchParams({
          connectorInstanceId: vars.connectorInstanceId,
        });
        if (vars.search && vars.search.length > 0) {
          params.set("search", vars.search);
        }
        if (vars.pageToken) params.set("pageToken", vars.pageToken);
        return `/api/connectors/google-sheets/sheets?${params.toString()}`;
      },
      method: "GET",
      body: () => undefined,
    }),

  selectSheet: () =>
    useAuthMutation<
      GoogleSheetsSelectSheetResponsePayload,
      GoogleSheetsSelectSheetRequest
    >({
      url: (vars) =>
        `/api/connectors/google-sheets/instances/${encodeURIComponent(
          vars.connectorInstanceId
        )}/select-sheet`,
      // Strip the path-only field; only `spreadsheetId` belongs in the body.
      body: (vars) => ({ spreadsheetId: vars.spreadsheetId }),
    }),

  sheetSlice: () =>
    useAuthMutation<
      GoogleSheetsSheetSliceResponsePayload,
      GoogleSheetsSheetSliceRequest
    >({
      url: (vars) => {
        const params = new URLSearchParams({
          sheetId: vars.sheetId,
          rowStart: String(vars.rowStart),
          rowEnd: String(vars.rowEnd),
          colStart: String(vars.colStart),
          colEnd: String(vars.colEnd),
        });
        return `/api/connectors/google-sheets/instances/${encodeURIComponent(
          vars.connectorInstanceId
        )}/sheet-slice?${params.toString()}`;
      },
      method: "GET",
      body: () => undefined,
    }),
};
