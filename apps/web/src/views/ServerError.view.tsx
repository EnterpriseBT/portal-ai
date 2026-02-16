import React from "react";
import { HttpErrorView, type HttpErrorViewProps } from "./HttpError.view";

type PartialHttpErrorProps = Omit<HttpErrorViewProps, "statusCode" | "title">;

export const ServerErrorView: React.FC<PartialHttpErrorProps> = (props) => (
  <HttpErrorView
    statusCode={500}
    title="Internal Server Error"
    description="Something went wrong on our end. Please try again later."
    {...props}
  />
);
