import type { Preview } from "@storybook/react";
import { ThemeProvider, type ThemeName } from "../src";
import "../src/assets/scss/index.scss";

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
        <ThemeProvider defaultTheme={theme}>
          <Story />
        </ThemeProvider>
      );
    },
  ],
};

export default preview;
