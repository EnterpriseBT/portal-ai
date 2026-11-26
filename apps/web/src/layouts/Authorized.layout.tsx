import {
  AppBar,
  Box,
  ButtonGroup,
  Toolbar,
  Typography,
} from "@portalai/core/ui";
import { HeaderMenu } from "../components/HeaderMenu.component";
import { NewPortalButton } from "../components/NewPortalButton.component";
import { CommandPalette } from "../components/CommandPalette.component";
import { CommandPaletteTriggerUI } from "../components/CommandPaletteTrigger.component";
import { ThemeSwitcher } from "../components/ThemeSwitcher.component";
import React from "react";
import { Link } from "@tanstack/react-router";
import { SidebarNav } from "../components/SidebarNav.component";
import { useLayout } from "../utils";
import { SidebarNavToggle } from "../components/SidebarNavToggle.component";
import { MAIN_CONTENT_ID, SkipLinks } from "../components/SkipLinks.component";
import { useRouteAnnouncer } from "../utils/route-announcer.util";
import { PortalLauncherProvider } from "../providers/PortalLauncher.provider";
import {
  detectPlatform,
  useCommandPaletteShortcut,
} from "../utils/use-command-palette-shortcut.util";

export const AuthorizedLayout = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { isMobileExpanded, isMobile } = useLayout();
  useRouteAnnouncer();
  // #1076: the command palette, from the header's search box or ⌘K / Ctrl+K.
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [platform] = React.useState(detectPlatform);
  const closePalette = React.useCallback(() => setPaletteOpen(false), []);
  const togglePalette = React.useCallback(
    () => setPaletteOpen((open) => !open),
    []
  );
  useCommandPaletteShortcut({
    open: paletteOpen,
    onToggle: togglePalette,
    platform,
  });
  return (
    // #1076: one launcher for the header button and the command palette.
    <PortalLauncherProvider>
      <Box display="flex" flexDirection="column" height={"100vh"}>
        <SkipLinks />
        <AppBar position="static" sx={{ paddingY: 1 }}>
          <Toolbar
            sx={{
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <ButtonGroup sx={{ display: "flex", alignItems: "center", gap: 1 }}>
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
                {/* The brand looks like a heading but isn't one: the page's h1
                  is its first heading (#797). */}
                <Typography
                  variant="h3"
                  component="span"
                  color="inherit"
                  margin="auto"
                >
                  Portals AI
                </Typography>
              </Link>
            </ButtonGroup>

            <Box display="flex" alignItems="center" gap={1}>
              {/* #1076: search and actions; an icon at phone width. */}
              <CommandPaletteTriggerUI
                onOpen={() => setPaletteOpen(true)}
                platform={platform}
                layout={isMobile ? "icon" : "full"}
              />
              {/* #1075: start a portal from any page; an icon at phone width. */}
              <NewPortalButton layout={isMobile ? "icon" : "full"} />
              <ButtonGroup>
                <ThemeSwitcher />
                <HeaderMenu />
              </ButtonGroup>
            </Box>
          </Toolbar>
        </AppBar>
        <Box display="flex" position="relative" flex={1} minHeight={0}>
          <SidebarNav />
          <Box
            component="main"
            id={MAIN_CONTENT_ID}
            tabIndex={-1}
            // Behind the open mobile drawer the page is dimmed and blocks the
            // pointer; inert takes it out of the Tab order too (#797).
            inert={isMobileExpanded || undefined}
            flex={1}
            overflow="auto"
            sx={(theme) => ({
              // Focus lands here from the skip link; the page, not the
              // container, shows where the user is.
              "&:focus": { outline: "none" },
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
        <CommandPalette open={paletteOpen} onClose={closePalette} />
      </Box>
    </PortalLauncherProvider>
  );
};
