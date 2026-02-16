import React from "react";
import { HttpErrorView, type HttpErrorViewProps } from "./HttpError.view";

type PartialHttpErrorProps = Omit<HttpErrorViewProps, "statusCode" | "title">;

export const UnauthorizedView: React.FC<PartialHttpErrorProps> = (props) => (
  <HttpErrorView
    statusCode={401}
    title="Unauthorized"
    description="You need to sign in to access this page."
    {...props}
  />
);
