import type { Meta, StoryObj } from "@storybook/react";
import {
  ThemeSwitcherUI,
  type ThemeConfig,
} from "../components/ThemeSwitcher.component";
import { fn } from "@storybook/test";
import { Box, IconName } from "@mcp-ui/core/ui";

const defaultThemes: ThemeConfig[] = [
  {
    label: "Light",
    themeName: "brand",
    icon: IconName.Sun,
  },
  {
    label: "Dark",
    themeName: "brand.dark",
    icon: IconName.Moon,
  },
];

const meta = {
  title: "Components/ThemeSwitcher",
  component: ThemeSwitcherUI,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    availableThemes: defaultThemes,
    onThemeSelect: fn(),
  },
} satisfies Meta<typeof ThemeSwitcherUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LightTheme: Story = {
  args: {
    currentThemeName: "brand",
  },
};

export const DarkTheme: Story = {
  args: {
    currentThemeName: "brand.dark",
  },
};

export const InAppBar: Story = {
  args: {
    currentThemeName: "brand",
  },
  decorators: [
    (Story) => (
      <Box
        sx={{
          bgcolor: "primary.main",
          color: "primary.contrastText",
          p: 2,
          borderRadius: 1,
        }}
      >
        <Story />
      </Box>
    ),
  ],
};

export const CustomThemes: Story = {
  args: {
    currentThemeName: "brand",
    availableThemes: [
      {
        label: "Ocean Breeze",
        themeName: "brand",
        icon: IconName.Star,
      },
      {
        label: "Midnight",
        themeName: "brand.dark",
        icon: IconName.Moon,
      },
    ],
  },
};

export const MultipleThemes: Story = {
  args: {
    currentThemeName: "brand",
    availableThemes: [
      {
        label: "Light Mode",
        themeName: "brand",
        icon: IconName.Sun,
      },
      {
        label: "Dark Mode",
        themeName: "brand.dark",
        icon: IconName.Moon,
      },
      // Future theme examples:
      // {
      //   label: "High Contrast",
      //   themeName: "brand.contrast",
      //   icon: IconName.Settings,
      // },
    ],
  },
};
