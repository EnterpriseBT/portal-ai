import { Box, Typography } from "@mcp-ui/core/ui";

export const EmptyResults = () => {
  return (
    <Box textAlign="center" py={10} px={6}>
      <Typography variant="h2" mb={2}>
        No results found
      </Typography>
      <Typography variant="body1" color="textSecondary">
        Try adjusting your search or filter to find what you are looking for.
      </Typography>
    </Box>
  );
};
