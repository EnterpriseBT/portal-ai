import { Typography, AppBar, Toolbar, Box } from "@mcp-ui/core";

export const PublicLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <Box
      data-testid="public-layout"
      display="flex"
      flexDirection="column"
      height={"100vh"}
    >
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h1">My App</Typography>
        </Toolbar>
      </AppBar>
      <Box flex={1} padding={3}>
        {children}
      </Box>
    </Box>
  );
};
