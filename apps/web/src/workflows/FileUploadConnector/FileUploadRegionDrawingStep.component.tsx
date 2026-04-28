import React from "react";

import { Stack } from "@portalai/core/ui";

import { RegionDrawingStepUI } from "../../modules/RegionEditor";
import type { RegionDrawingStepUIProps } from "../../modules/RegionEditor";
import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";

export interface FileUploadRegionDrawingStepUIProps extends RegionDrawingStepUIProps {
  serverError: ServerError | null;
}

export const FileUploadRegionDrawingStepUI: React.FC<
  FileUploadRegionDrawingStepUIProps
> = ({ serverError, ...regionProps }) => {
  return (
    <Stack spacing={2}>
      {serverError && <FormAlert serverError={serverError} />}
      <RegionDrawingStepUI {...regionProps} />
    </Stack>
  );
};
