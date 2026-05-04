/**
 * Microsoft 365 Excel connector — frontend SDK.
 *
 * Four surfaces:
 *   - `authorize` — POST to mint the consent URL the popup hook opens.
 *   - `searchWorkbooks` — imperative GET against Graph search.
 *   - `selectWorkbook` — POST to download + parse + cache the chosen
 *     workbook server-side.
 *   - `sheetSlice` — imperative GET for cell rectangles on big sheets;
 *     plugged into RegionEditor's `loadSlice` callback at the workflow
 *     level (per `feedback_sdk_helpers_for_api`, never via `fetch`).
 */

import type {
  MicrosoftExcelAuthorizeResponsePayload,
  MicrosoftExcelListWorkbooksRequestQuery,
  MicrosoftExcelListWorkbooksResponsePayload,
  MicrosoftExcelSelectWorkbookRequest,
  MicrosoftExcelSelectWorkbookResponsePayload,
  MicrosoftExcelSheetSliceRequest,
  MicrosoftExcelSheetSliceResponsePayload,
} from "@portalai/core/contracts";

import { useAuthMutation } from "../utils/api.util";

export const microsoftExcel = {
  authorize: () =>
    useAuthMutation<MicrosoftExcelAuthorizeResponsePayload, void>({
      url: "/api/connectors/microsoft-excel/authorize",
    }),

  searchWorkbooks: () =>
    useAuthMutation<
      MicrosoftExcelListWorkbooksResponsePayload,
      MicrosoftExcelListWorkbooksRequestQuery
    >({
      url: (vars) => {
        const params = new URLSearchParams({
          connectorInstanceId: vars.connectorInstanceId,
        });
        if (vars.search && vars.search.length > 0) {
          params.set("search", vars.search);
        }
        return `/api/connectors/microsoft-excel/workbooks?${params.toString()}`;
      },
      method: "GET",
      body: () => undefined,
    }),

  selectWorkbook: () =>
    useAuthMutation<
      MicrosoftExcelSelectWorkbookResponsePayload,
      MicrosoftExcelSelectWorkbookRequest
    >({
      url: (vars) =>
        `/api/connectors/microsoft-excel/instances/${encodeURIComponent(
          vars.connectorInstanceId
        )}/select-workbook`,
      // Strip the path-only field; only `driveItemId` belongs in the body.
      body: (vars) => ({ driveItemId: vars.driveItemId }),
    }),

  sheetSlice: () =>
    useAuthMutation<
      MicrosoftExcelSheetSliceResponsePayload,
      MicrosoftExcelSheetSliceRequest
    >({
      url: (vars) => {
        const params = new URLSearchParams({
          sheetId: vars.sheetId,
          rowStart: String(vars.rowStart),
          rowEnd: String(vars.rowEnd),
          colStart: String(vars.colStart),
          colEnd: String(vars.colEnd),
        });
        return `/api/connectors/microsoft-excel/instances/${encodeURIComponent(
          vars.connectorInstanceId
        )}/sheet-slice?${params.toString()}`;
      },
      method: "GET",
      body: () => undefined,
    }),
};
