import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { RadioGroup } from "../ui/RadioGroup";

const sampleOptions = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

const meta = {
  title: "Components/Form/RadioGroup",
  component: RadioGroup,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    label: {
      control: "text",
      description: "Label for the radio group",
    },
    helperText: {
      control: "text",
      description: "Helper text displayed below the group",
    },
    error: {
      control: "boolean",
      description: "Whether to display an error state",
    },
    row: {
      control: "boolean",
      description: "Whether to display options in a row",
    },
  },
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "Size",
    options: sampleOptions,
  },
};

export const Row: Story = {
  args: {
    label: "Size",
    options: sampleOptions,
    row: true,
  },
};

export const WithHelperText: Story = {
  args: {
    label: "Size",
    options: sampleOptions,
    helperText: "Select your preferred size",
  },
};

export const ErrorState: Story = {
  args: {
    label: "Size",
    options: sampleOptions,
    error: true,
    helperText: "Please select a size",
  },
};

export const WithDisabledOption: Story = {
  args: {
    label: "Size",
    options: [
      ...sampleOptions,
      { value: "xl", label: "Extra Large (unavailable)", disabled: true },
    ],
  },
};

export const Interactive: Story = {
  args: {
    label: "Size",
    options: sampleOptions,
  },
  render: () => {
    const [value, setValue] = useState("medium");
    return (
      <RadioGroup
        label="Size"
        options={sampleOptions}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    );
  },
};
