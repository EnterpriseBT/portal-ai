import { createRouter } from "@tanstack/react-router";
import { queryClient } from "./client";

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

// Register router for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
