import type { Preview } from "@storybook/react";
import { type ThemeName } from "@mcp-ui/core";
import { AppProvider } from "../src/App";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  globalTypes: {
    theme: {
      name: "Theme",
      description: "Global theme for components",
      defaultValue: "brand",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "brand", title: "Brand Light", icon: "sun" },
          { value: "brand.dark", title: "Brand Dark", icon: "moon" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme as ThemeName;
      return (
        <AppProvider defaultTheme={theme}>
          <Story />
        </AppProvider>
      );
    },
  ],
};

export default preview;
