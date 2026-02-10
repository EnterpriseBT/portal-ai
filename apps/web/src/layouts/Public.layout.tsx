import Box from "@mui/material/Box";
import { Typography, AppBar, Toolbar } from "@mcp-ui/core";

export const PublicLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <Box display="flex" flexDirection="column" height={"100vh"}>
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
