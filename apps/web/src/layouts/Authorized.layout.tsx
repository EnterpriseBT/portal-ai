import { AppBar, Box, ButtonGroup, Toolbar, Typography } from "@mcp-ui/core/ui";
import { HeaderMenu } from "../components/HeaderMenu.component";
import { ThemeSwitcher } from "../components/ThemeSwitcher.component";
import React from "react";
import { Link } from "@tanstack/react-router";
import { SidebarNav } from "../components/SidebarNav.component";
import { useLayout } from "../utils";
import { SidebarNavToggle } from "../components/SidebarNavToggle.component";

export const AuthorizedLayout = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { isMobileExpanded, isMobile } = useLayout();
  return (
    <Box display="flex" flexDirection="column" height={"100vh"}>
      <AppBar position="static" sx={{ paddingY: 1 }}>
        <Toolbar
          sx={{
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <ButtonGroup sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            {isMobile && <SidebarNavToggle />}
            <Link
              to="/"
              style={{
                textDecoration: "none",
                color: "inherit",
                display: "flex",
                alignItems: "center",
              }}
            >
              <Typography variant="h5" color="inherit" margin="auto">
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
      <Box display="flex" position="relative" flex={1} minHeight={0}>
        <SidebarNav />
        <Box
          flex={1}
          overflow="auto"
          sx={(theme) => ({
            background: isMobileExpanded
              ? theme.darken(theme.palette.background.default, 0.2)
              : theme.palette.background.default,
            pointerEvents: isMobileExpanded ? "none" : "auto",
            padding: theme.spacing(3),
          })}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
};
