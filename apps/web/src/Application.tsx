import React from "react";

import { RouterProvider } from "@tanstack/react-router";

import { router } from "./router";
import { ApplicationProvider } from "./providers/Application.provider";
import { UpdateBanner } from "./components/UpdateBanner.component";

// #884: a completed login navigates (replace) through the router; the session
// stays loading until it lands, and the callback's ?code=&state= go.
const returnAfterLogin = (href: string) =>
  router.navigate({ href, replace: true });

export const Application: React.FC = () => {
  return (
    <ApplicationProvider onLoginReturn={returnAfterLogin}>
      <RouterProvider router={router} />
      <UpdateBanner />
    </ApplicationProvider>
  );
};
