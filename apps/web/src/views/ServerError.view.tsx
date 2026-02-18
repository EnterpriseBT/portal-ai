import React from "react";
import {
  HttpError,
  type HttpErrorProps,
} from "../components/HttpError.component";

type PartialHttpErrorProps = Omit<HttpErrorProps, "statusCode" | "title">;

export const ServerErrorView: React.FC<PartialHttpErrorProps> = (props) => (
  <HttpError
    statusCode={500}
    title="Internal Server Error"
    description="Something went wrong on our end. Please try again later."
    {...props}
  />
);
