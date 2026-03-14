import { Box, Typography } from "@portalai/core/ui";

export const EmptyResults = () => {
  return (
    <Box textAlign="center" py={10}>
      <Typography variant="h2" mb={2}>
        No results found
      </Typography>
      <Typography variant="body1" color="textSecondary">
        Try adjusting your search or filter to find what you are looking for.
      </Typography>
    </Box>
  );
};
