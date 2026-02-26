import { AppBar, Box, ButtonGroup, Toolbar, Typography } from "@mcp-ui/core/ui";
import { HeaderMenu } from "../components/HeaderMenu.component";
import { ThemeSwitcher } from "../components/ThemeSwitcher.component";
import React from "react";
import { Link } from "@tanstack/react-router";
import { SidebarNavToggle } from "../components/SidebarNavToggle.component";

export const AuthorizedLayout = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  return (
    <Box display="flex" flexDirection="column" height={"100vh"}>
      <AppBar position="static">
        <Toolbar
          sx={{
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <ButtonGroup>
            <SidebarNavToggle />
            <Link
              to="/"
              style={{
                textDecoration: "none",
                color: "inherit",
                display: "flex",
                alignItems: "center",
              }}
            >
              <Typography variant="h6" color="inherit" margin="auto">
                MCP UI
              </Typography>
            </Link>
          </ButtonGroup>

          <ButtonGroup>
            <ThemeSwitcher />
            <HeaderMenu />
          </ButtonGroup>
        </Toolbar>
      </AppBar>
      <Box flex={1} padding={3} overflow="auto">
        {children}
      </Box>
    </Box>
  );
};
