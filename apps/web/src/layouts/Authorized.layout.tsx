import { Box, ButtonGroup } from "@mcp-ui/core/ui";
import { Header } from "../components/Header.component";
import { NavbarMenu } from "../components/NavbarMenu.component";
import { ThemeSwitcher } from "../components/ThemeSwitcher.component";
import React from "react";

export const AuthorizedLayout = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  return (
    <Box display="flex" flexDirection="column" height={"100vh"}>
      <Header>
        <ButtonGroup>
          <ThemeSwitcher />
          <NavbarMenu />
        </ButtonGroup>
      </Header>
      <Box flex={1} padding={3} overflow="auto">
        {children}
      </Box>
    </Box>
  );
};
