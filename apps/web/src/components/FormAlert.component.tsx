import React from "react";

import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";

import type { ServerError } from "../utils/api.util";
import { serverErrorMessage } from "../utils/permission-denied.util";

export interface FormAlertProps {
  serverError: ServerError | null;
}

export const FormAlert: React.FC<FormAlertProps> = ({ serverError }) => {
  if (!serverError) return null;

  // #711: a permission refusal's message names the permission, so it's the
  // lead, shown once (`serverErrorMessage` supplies the standard lead only
  // when it's empty). The code stays as a caption for support.
  return (
    <Alert severity="error">
      {serverErrorMessage(serverError)}{" "}
      <Typography component="span" variant="caption" color="text.secondary">
        {`(${serverError.code})`}
      </Typography>
    </Alert>
  );
};
