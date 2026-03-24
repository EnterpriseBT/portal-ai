import React, { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { ColorPicker, type ColorPickerProps } from "../ui/ColorPicker.js";

const meta = {
  title: "Components/ColorPicker",
  component: ColorPicker,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    value: {
      control: "color",
      description: "Current hex color value",
    },
    wheelSize: {
      control: { type: "range", min: 100, max: 400, step: 10 },
      description: "Size of the color wheel in pixels",
    },
    label: {
      control: "text",
      description: "Label displayed above the picker",
    },
    disabled: {
      control: "boolean",
      description: "Whether the picker is disabled",
    },
  },
} satisfies Meta<typeof ColorPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

const InteractiveWrapper: React.FC<ColorPickerProps> = (props) => {
  const [color, setColor] = useState(props.value ?? "#3b82f6");
  return (
    <Box>
      <ColorPicker {...props} value={color} onChange={setColor} />
      <Typography variant="caption" sx={{ mt: 2, display: "block" }}>
        Selected: {color}
      </Typography>
    </Box>
  );
};

export const Default: Story = {
  args: {
    value: "#3b82f6",
    wheelSize: 200,
  },
  render: (args) => <InteractiveWrapper {...args} />,
};

export const WithLabel: Story = {
  args: {
    value: "#e91e63",
    label: "Brand Color",
    wheelSize: 200,
  },
  render: (args) => <InteractiveWrapper {...args} />,
};

export const WithSamples: Story = {
  args: {
    value: "#3b82f6",
    label: "Theme Color",
    wheelSize: 200,
    samples: [
      { color: "#ef4444", label: "Red" },
      { color: "#f97316", label: "Orange" },
      { color: "#eab308", label: "Yellow" },
      { color: "#22c55e", label: "Green" },
      { color: "#3b82f6", label: "Blue" },
      { color: "#8b5cf6", label: "Purple" },
      { color: "#ec4899", label: "Pink" },
      { color: "#64748b", label: "Slate" },
    ],
  },
  render: (args) => <InteractiveWrapper {...args} />,
};

export const MaterialDesignSamples: Story = {
  args: {
    value: "#2196f3",
    label: "Material Color",
    wheelSize: 200,
    samples: [
      { color: "#f44336", label: "Red" },
      { color: "#e91e63", label: "Pink" },
      { color: "#9c27b0", label: "Purple" },
      { color: "#673ab7", label: "Deep Purple" },
      { color: "#3f51b5", label: "Indigo" },
      { color: "#2196f3", label: "Blue" },
      { color: "#00bcd4", label: "Cyan" },
      { color: "#009688", label: "Teal" },
      { color: "#4caf50", label: "Green" },
      { color: "#ff9800", label: "Orange" },
      { color: "#795548", label: "Brown" },
      { color: "#607d8b", label: "Blue Grey" },
    ],
  },
  render: (args) => <InteractiveWrapper {...args} />,
};

export const SmallWheel: Story = {
  args: {
    value: "#22c55e",
    wheelSize: 120,
    label: "Compact Picker",
  },
  render: (args) => <InteractiveWrapper {...args} />,
};

export const LargeWheel: Story = {
  args: {
    value: "#8b5cf6",
    wheelSize: 300,
    label: "Large Picker",
  },
  render: (args) => <InteractiveWrapper {...args} />,
};

export const Disabled: Story = {
  args: {
    value: "#3b82f6",
    label: "Disabled Picker",
    wheelSize: 200,
    disabled: true,
    samples: [
      { color: "#ef4444", label: "Red" },
      { color: "#3b82f6", label: "Blue" },
      { color: "#22c55e", label: "Green" },
    ],
  },
};
