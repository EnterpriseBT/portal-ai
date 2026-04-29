import React, { useMemo } from "react";

import { Stack } from "@portalai/core/ui";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";

import { ReviewStepUI } from "../../modules/RegionEditor";
import type { ReviewStepUIProps } from "../../modules/RegionEditor";
import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";

export interface GoogleSheetsReviewStepUIProps extends ReviewStepUIProps {
  serverError: ServerError | null;
}

/**
 * Friendly label for a region in the banner — falls back to id when no
 * proposedLabel is set so the user can match the warning to a row in the
 * review list.
 */
function regionLabel(region: ReviewStepUIProps["regions"][number]): string {
  return region.proposedLabel?.trim() || region.id;
}

export const GoogleSheetsReviewStep: React.FC<GoogleSheetsReviewStepUIProps> = ({
  serverError,
  ...reviewProps
}) => {
  const rowPositionRegions = useMemo(
    () =>
      reviewProps.regions.filter(
        (r) => r.identityStrategy?.kind === "rowPosition"
      ),
    [reviewProps.regions]
  );

  return (
    <Stack spacing={2}>
      {serverError && <FormAlert serverError={serverError} />}

      {rowPositionRegions.length > 0 && (
        <Alert severity="warning" role="status" variant="outlined">
          <AlertTitle>One-shot import only</AlertTitle>
          <p>
            {rowPositionRegions.length === 1
              ? "This region uses positional row IDs"
              : "These regions use positional row IDs"}
            : {rowPositionRegions.map((r) => regionLabel(r)).join(", ")}.
          </p>
          <p>
            They can be imported once but won't be eligible for re-sync.{" "}
            <strong>Add an identifier column</strong> (something unique per row
            — an id, email, slug) and the connector will be able to keep the
            rows in sync as the source sheet changes. You can still commit and
            edit later.
          </p>
        </Alert>
      )}

      <ReviewStepUI {...reviewProps} />
    </Stack>
  );
};
