import React from "react";

import { RouterProvider } from "@tanstack/react-router";

import { router } from "./router";
import { ApplicationProvider } from "./providers/Application.provider";
import { UpdateBanner } from "./components/UpdateBanner.component";

export const Application: React.FC = () => {
  return (
    <ApplicationProvider>
      <RouterProvider router={router} />
      <UpdateBanner />
    </ApplicationProvider>
  );
};
