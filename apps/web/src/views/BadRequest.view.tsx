import React from "react";
import {
  HttpError,
  type HttpErrorProps,
} from "../components/HttpError.component";

type PartialHttpErrorProps = Omit<HttpErrorProps, "statusCode" | "title">;

export const BadRequestView: React.FC<PartialHttpErrorProps> = (props) => (
  <HttpError
    statusCode={400}
    title="Bad Request"
    description="The server could not understand the request due to invalid syntax."
    {...props}
  />
);
