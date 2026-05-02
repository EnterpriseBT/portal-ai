/**
 * Microsoft 365 Excel connector — frontend SDK.
 *
 * Phase A only ships `authorize`. Phase B adds `searchWorkbooks`,
 * `selectWorkbook`, and `sheetSlice` once the API exposes them.
 */

import type { MicrosoftExcelAuthorizeResponsePayload } from "@portalai/core/contracts";

import { useAuthMutation } from "../utils/api.util";

export const microsoftExcel = {
  authorize: () =>
    useAuthMutation<MicrosoftExcelAuthorizeResponsePayload, void>({
      url: "/api/connectors/microsoft-excel/authorize",
    }),
};
