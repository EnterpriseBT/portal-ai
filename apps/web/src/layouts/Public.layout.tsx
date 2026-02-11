import { Typography, AppBar, Toolbar, Box } from "@mcp-ui/core";

export const PublicLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <Box display="flex" flexDirection="column" height={"100vh"}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h2">My App</Typography>
        </Toolbar>
      </AppBar>
      <Box flex={1} padding={3} overflow="auto">
        {children}
      </Box>
    </Box>
  );
};
