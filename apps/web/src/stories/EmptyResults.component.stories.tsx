import type { Meta, StoryObj } from "@storybook/react";
import { EmptyResults } from "../components/EmptyResults.component";

const meta = {
  title: "Components/EmptyResults",
  component: EmptyResults,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof EmptyResults>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
