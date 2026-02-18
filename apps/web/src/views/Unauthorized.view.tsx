import React from "react";
import {
  HttpError,
  type HttpErrorProps,
} from "../components/HttpError.component";

type PartialHttpErrorProps = Omit<HttpErrorProps, "statusCode" | "title">;

export const UnauthorizedView: React.FC<PartialHttpErrorProps> = (props) => (
  <HttpError
    statusCode={401}
    title="Unauthorized"
    description="You need to sign in to access this page."
    {...props}
  />
);
