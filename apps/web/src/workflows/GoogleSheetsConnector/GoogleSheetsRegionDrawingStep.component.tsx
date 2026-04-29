import React from "react";

import { Stack } from "@portalai/core/ui";

import { RegionDrawingStepUI } from "../../modules/RegionEditor";
import type { RegionDrawingStepUIProps } from "../../modules/RegionEditor";
import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";

/**
 * Workflow-shaped wrapper around `<RegionDrawingStepUI>` for the
 * Google Sheets pipeline. Identical shape to FileUploadRegionDrawingStep
 * — the only difference is the `loadSlice` callback the workflow
 * container provides, which closes over `connectorInstanceId` instead
 * of `uploadSessionId`. RegionEditor itself is workbook-shape-agnostic
 * (Phase A audit confirmed; see Phase C plan §What already exists).
 *
 * If a third workflow surfaces the same shell, promote to a shared
 * `<RegionDrawingStepWithErrorUI>` in the module.
 */
export interface GoogleSheetsRegionDrawingStepUIProps
  extends RegionDrawingStepUIProps {
  serverError: ServerError | null;
}

export const GoogleSheetsRegionDrawingStep: React.FC<
  GoogleSheetsRegionDrawingStepUIProps
> = ({ serverError, ...regionProps }) => {
  return (
    <Stack spacing={2}>
      {serverError && <FormAlert serverError={serverError} />}
      <RegionDrawingStepUI {...regionProps} />
    </Stack>
  );
};
