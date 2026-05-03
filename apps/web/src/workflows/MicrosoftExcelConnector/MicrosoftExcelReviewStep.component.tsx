import React, { useMemo } from "react";

import { Stack } from "@portalai/core/ui";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";

import { ReviewStepUI } from "../../modules/RegionEditor";
import type { ReviewStepUIProps } from "../../modules/RegionEditor";
import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";

export interface MicrosoftExcelReviewStepUIProps extends ReviewStepUIProps {
  serverError: ServerError | null;
}

/** Friendly label for a region in the banner. */
function regionLabel(region: ReviewStepUIProps["regions"][number]): string {
  return region.proposedLabel?.trim() || region.id;
}

export const MicrosoftExcelReviewStep: React.FC<
  MicrosoftExcelReviewStepUIProps
> = ({ serverError, ...reviewProps }) => {
  const rowPositionRegions = useMemo(
    () =>
      reviewProps.regions.filter(
        (r) => r.identityStrategy?.kind === "rowPosition"
      ),
    [reviewProps.regions]
  );

  const isPlural = rowPositionRegions.length !== 1;

  return (
    <Stack spacing={2}>
      {serverError && <FormAlert serverError={serverError} />}

      {rowPositionRegions.length > 0 && (
        <Alert severity="info" role="status" variant="outlined">
          <AlertTitle>
            No stable identity for {isPlural ? "these regions" : "this region"}
          </AlertTitle>
          <p>
            {isPlural
              ? "These regions have no identity field"
              : "This region has no identity field"}
            : {rowPositionRegions.map((r) => regionLabel(r)).join(", ")}.
          </p>
          <p>
            Records will be reaped and re-created on every sync. To keep
            records stable across syncs, <strong>pick an identity field</strong>
            {" "}(something unique per row — an id, email, slug). You can still
            commit and edit later.
          </p>
        </Alert>
      )}

      <ReviewStepUI {...reviewProps} />
    </Stack>
  );
};
