import React from "react";
import { Box, ButtonGroup } from "@mcp-ui/core";
import { Header } from "../components/Header.component";
import { ThemeSwitcher } from "../components/ThemeSwitcher.component";

export const PublicLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <Box display="flex" flexDirection="column" height={"100vh"}>
      <Header>
        <ButtonGroup>
          <ThemeSwitcher />
        </ButtonGroup>
      </Header>
      <Box flex={1} padding={3} overflow="auto">
        {children}
      </Box>
    </Box>
  );
};
