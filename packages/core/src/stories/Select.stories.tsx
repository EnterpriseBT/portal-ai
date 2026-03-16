import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Select } from "../ui/Select";

const sampleOptions = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry" },
  { value: "grape", label: "Grape" },
];

const meta = {
  title: "Components/Form/Select",
  component: Select,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    label: {
      control: "text",
      description: "Label text for the select",
    },
    helperText: {
      control: "text",
      description: "Helper text displayed below the select",
    },
    error: {
      control: "boolean",
      description: "Whether to display an error state",
    },
    disabled: {
      control: "boolean",
      description: "Whether the select is disabled",
    },
    required: {
      control: "boolean",
      description: "Whether the select is required",
    },
    size: {
      control: "select",
      options: ["small", "medium"],
      description: "The size of the select",
    },
    variant: {
      control: "select",
      options: ["outlined", "filled", "standard"],
      description: "The variant of the select",
    },
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "Fruit",
    options: sampleOptions,
    value: "",
    sx: { minWidth: 200 },
  },
};

export const WithPlaceholder: Story = {
  args: {
    label: "Fruit",
    options: sampleOptions,
    placeholder: "Select a fruit...",
    value: "",
    sx: { minWidth: 200 },
  },
};

export const WithHelperText: Story = {
  args: {
    label: "Fruit",
    options: sampleOptions,
    helperText: "Choose your favorite fruit",
    value: "apple",
    sx: { minWidth: 200 },
  },
};

export const ErrorState: Story = {
  args: {
    label: "Fruit",
    options: sampleOptions,
    error: true,
    helperText: "Selection is required",
    value: "",
    sx: { minWidth: 200 },
  },
};

export const Disabled: Story = {
  args: {
    label: "Fruit",
    options: sampleOptions,
    disabled: true,
    value: "banana",
    sx: { minWidth: 200 },
  },
};

export const WithDisabledOption: Story = {
  args: {
    label: "Fruit",
    options: [
      ...sampleOptions,
      { value: "mango", label: "Mango (out of stock)", disabled: true },
    ],
    value: "",
    sx: { minWidth: 200 },
  },
};

export const Interactive: Story = {
  render: () => {
    const [value, setValue] = useState("");
    return (
      <Select
        label="Fruit"
        options={sampleOptions}
        value={value}
        onChange={(e) => setValue(e.target.value as string)}
        placeholder="Select a fruit..."
        sx={{ minWidth: 200 }}
      />
    );
  },
};
