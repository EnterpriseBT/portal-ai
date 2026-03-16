import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Checkbox } from "../ui/Checkbox";

const meta = {
  title: "Components/Form/Checkbox",
  component: Checkbox,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    label: {
      control: "text",
      description: "Label text for the checkbox",
    },
    helperText: {
      control: "text",
      description: "Helper text displayed below the checkbox",
    },
    error: {
      control: "boolean",
      description: "Whether to display an error state",
    },
    disabled: {
      control: "boolean",
      description: "Whether the checkbox is disabled",
    },
    checked: {
      control: "boolean",
      description: "Whether the checkbox is checked",
    },
    color: {
      control: "select",
      options: ["primary", "secondary", "success", "error", "warning"],
      description: "The color of the checkbox",
    },
  },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "Accept terms and conditions",
  },
};

export const Checked: Story = {
  args: {
    label: "I agree",
    checked: true,
  },
};

export const WithHelperText: Story = {
  args: {
    label: "Subscribe to newsletter",
    helperText: "You can unsubscribe at any time",
  },
};

export const ErrorState: Story = {
  args: {
    label: "Required checkbox",
    error: true,
    helperText: "You must accept the terms",
  },
};

export const Disabled: Story = {
  args: {
    label: "Disabled option",
    disabled: true,
  },
};

export const Interactive: Story = {
  render: () => {
    const [checked, setChecked] = useState(false);
    return (
      <Checkbox
        label={checked ? "Checked!" : "Click me"}
        checked={checked}
        onChange={(val) => setChecked(val)}
      />
    );
  },
};
