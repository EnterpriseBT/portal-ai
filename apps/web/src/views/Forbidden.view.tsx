import React from "react";
import {
  HttpError,
  type HttpErrorProps,
} from "../components/HttpError.component";

type PartialHttpErrorProps = Omit<HttpErrorProps, "statusCode" | "title">;

export const ForbiddenView: React.FC<PartialHttpErrorProps> = (props) => (
  <HttpError
    statusCode={403}
    title="Forbidden"
    description="You don't have permission to access this resource."
    {...props}
  />
);
