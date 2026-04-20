import React from "react";

import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";

import type { ServerError } from "../utils/api.util";

export interface FormAlertProps {
  serverError: ServerError | null;
}

export const FormAlert: React.FC<FormAlertProps> = ({ serverError }) => {
  if (!serverError) return null;

  return (
    <Alert severity="error">
      {serverError.message}{" "}
      <Typography component="span" variant="caption" color="text.secondary">
        ({serverError.code})
      </Typography>
    </Alert>
  );
};
