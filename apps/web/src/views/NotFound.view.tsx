import React from "react";
import { HttpErrorView, type HttpErrorViewProps } from "./HttpError.view";

type PartialHttpErrorProps = Omit<HttpErrorViewProps, "statusCode" | "title">;

export const NotFoundView: React.FC<PartialHttpErrorProps> = (props) => (
  <HttpErrorView
    statusCode={404}
    title="Page Not Found"
    description="The page you're looking for doesn't exist or has been moved."
    {...props}
  />
);
