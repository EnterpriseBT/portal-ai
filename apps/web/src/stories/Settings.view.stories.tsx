import type { Meta, StoryObj } from "@storybook/react";
import { SettingsView } from "../views/Settings.view";

const meta = {
  title: "Views/SettingsView",
  component: SettingsView,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof SettingsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
