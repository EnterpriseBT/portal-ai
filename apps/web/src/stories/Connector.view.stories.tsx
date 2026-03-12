import type { Meta, StoryObj } from "@storybook/react";
import { ConnectorView } from "../views/ConnectorView";

const meta = {
  title: "Views/ConnectorView",
  component: ConnectorView,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ConnectorView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
