import React from "react";

import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";

import type { ServerError } from "../utils/api.util";
import {
  isPermissionDenied,
  PERMISSION_DENIED_MESSAGE,
} from "../utils/permission-denied.util";

export interface FormAlertProps {
  serverError: ServerError | null;
}

export const FormAlert: React.FC<FormAlertProps> = ({ serverError }) => {
  if (!serverError) return null;

  // #576: a role/permission denial reads consistently everywhere — a
  // standardized lead, with the server's specific reason kept as detail.
  const denied = isPermissionDenied(serverError);

  return (
    <Alert severity="error">
      {denied ? PERMISSION_DENIED_MESSAGE : serverError.message}{" "}
      <Typography component="span" variant="caption" color="text.secondary">
        {denied
          ? `${serverError.message} (${serverError.code})`
          : `(${serverError.code})`}
      </Typography>
    </Alert>
  );
};
