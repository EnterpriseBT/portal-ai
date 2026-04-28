import React from "react";

import { Stack } from "@portalai/core/ui";

import { ReviewStepUI } from "../../modules/RegionEditor";
import type { ReviewStepUIProps } from "../../modules/RegionEditor";
import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";

export interface FileUploadReviewStepUIProps extends ReviewStepUIProps {
  serverError: ServerError | null;
}

export const FileUploadReviewStepUI: React.FC<FileUploadReviewStepUIProps> = ({
  serverError,
  ...reviewProps
}) => {
  return (
    <Stack spacing={2}>
      {serverError && <FormAlert serverError={serverError} />}
      <ReviewStepUI {...reviewProps} />
    </Stack>
  );
};
