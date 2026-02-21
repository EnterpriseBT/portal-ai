import type { Meta, StoryObj } from "@storybook/react";
import { Typography } from "../ui/Typography";

const meta = {
  title: "Components/Typography",
  component: Typography,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "subtitle1",
        "subtitle2",
        "body1",
        "body2",
        "button",
        "caption",
        "overline",
        "monospace",
      ],
      description: "The variant of the typography",
    },
    color: {
      control: "select",
      options: [
        "primary",
        "secondary",
        "text.primary",
        "text.secondary",
        "text.disabled",
        "error",
        "warning",
        "info",
        "success",
      ],
      description: "The color of the typography",
    },
    align: {
      control: "select",
      options: ["left", "center", "right", "justify"],
      description: "The text alignment",
    },
    gutterBottom: {
      control: "boolean",
      description: "Whether to add bottom margin",
    },
    noWrap: {
      control: "boolean",
      description: "Whether to prevent text wrapping",
    },
  },
} satisfies Meta<typeof Typography>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "Typography",
    variant: "body1",
    color: "text.primary",
    align: "left",
    gutterBottom: false,
    noWrap: false,
  },
};
