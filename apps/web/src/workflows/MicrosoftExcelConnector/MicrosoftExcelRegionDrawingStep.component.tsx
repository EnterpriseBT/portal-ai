import React from "react";

import { Stack } from "@portalai/core/ui";

import { RegionDrawingStepUI } from "../../modules/RegionEditor";
import type { RegionDrawingStepUIProps } from "../../modules/RegionEditor";
import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";

/**
 * Workflow-shaped wrapper around `<RegionDrawingStepUI>` for the
 * Microsoft 365 Excel pipeline. Identical shape to the file-upload and
 * google-sheets wrappers — the only difference is the `loadSlice`
 * callback the workflow container provides, which closes over
 * `connectorInstanceId` (microsoft-excel) instead of `uploadSessionId`
 * or `connectorInstanceId` (google-sheets). RegionEditor itself is
 * workbook-shape-agnostic.
 */
export interface MicrosoftExcelRegionDrawingStepUIProps
  extends RegionDrawingStepUIProps {
  serverError: ServerError | null;
}

export const MicrosoftExcelRegionDrawingStep: React.FC<
  MicrosoftExcelRegionDrawingStepUIProps
> = ({ serverError, ...regionProps }) => {
  return (
    <Stack spacing={2}>
      {serverError && <FormAlert serverError={serverError} />}
      <RegionDrawingStepUI {...regionProps} />
    </Stack>
  );
};
