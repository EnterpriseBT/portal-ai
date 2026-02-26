import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import React from "react";
import { ApplicationProvider } from "./providers/Application.provider";

export const Application: React.FC = () => {
  return (
    <ApplicationProvider>
      <RouterProvider router={router} />
    </ApplicationProvider>
  );
};
