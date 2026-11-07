import { Box, CircularProgress, HiddenPageHeading } from "@portalai/core/ui";

/** The root route's pending state. The hidden h1 gives the page a title for
 *  screen readers and the tab while the route loads (#797); the spinner's
 *  name comes from the theme. */
export const LoadingView = () => {
  return (
    <Box data-testid="loading-view" display="flex" justifyContent="center">
      <HiddenPageHeading>Loading</HiddenPageHeading>
      <CircularProgress />
    </Box>
  );
};
