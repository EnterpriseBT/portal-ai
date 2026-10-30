import { createRouter } from "@tanstack/react-router";
import { queryClient } from "./client";
import { registerNotInvitedHandler } from "./utils/auth-error.util";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

// Create router with generated routes
export const router = createRouter({
  routeTree,
  context: {
    queryClient,
  },
  defaultPreload: "intent",
});

// #916: an uninvited enterprise login (raised by the query client) goes to
// the not-invited page. Registered here, at module load, so no refusal can
// arrive before a handler exists. The client can't import the router itself:
// this module already imports the client.
registerNotInvitedHandler(() => {
  // Every refused request raises this (a page load fires several); once the
  // caller is on the page, a late one must not navigate again.
  if (window.location.pathname === "/not-invited") return;
  void router.navigate({ to: "/not-invited", replace: true });
});

// Register router for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
