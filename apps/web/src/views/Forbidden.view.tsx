import React from "react";
import { HttpErrorView, type HttpErrorViewProps } from "./HttpError.view";

type PartialHttpErrorProps = Omit<HttpErrorViewProps, "statusCode" | "title">;

export const ForbiddenView: React.FC<PartialHttpErrorProps> = (props) => (
  <HttpErrorView
    statusCode={403}
    title="Forbidden"
    description="You don't have permission to access this resource."
    {...props}
  />
);
