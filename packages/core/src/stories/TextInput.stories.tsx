import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { TextInput } from "../ui/TextInput";

const meta = {
  title: "Components/Form/TextInput",
  component: TextInput,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    label: {
      control: "text",
      description: "Label text for the input",
    },
    placeholder: {
      control: "text",
      description: "Placeholder text",
    },
    helperText: {
      control: "text",
      description: "Helper text displayed below the input",
    },
    error: {
      control: "boolean",
      description: "Whether to display the input in an error state",
    },
    disabled: {
      control: "boolean",
      description: "Whether the input is disabled",
    },
    required: {
      control: "boolean",
      description: "Whether the input is required",
    },
    type: {
      control: "select",
      options: ["text", "password", "email", "number", "tel", "url"],
      description: "The input type",
    },
    size: {
      control: "select",
      options: ["small", "medium"],
      description: "The size of the input",
    },
    variant: {
      control: "select",
      options: ["outlined", "filled", "standard"],
      description: "The variant of the input",
    },
    multiline: {
      control: "boolean",
      description: "Whether the input is multiline",
    },
    rows: {
      control: "number",
      description: "Number of rows for multiline",
    },
  },
} satisfies Meta<typeof TextInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "Name",
    placeholder: "Enter your name",
  },
};

export const WithHelperText: Story = {
  args: {
    label: "Email",
    placeholder: "user@example.com",
    helperText: "We'll never share your email",
    type: "email",
  },
};

export const ErrorState: Story = {
  args: {
    label: "Password",
    type: "password",
    error: true,
    helperText: "Password must be at least 8 characters",
  },
};

export const Disabled: Story = {
  args: {
    label: "Disabled Input",
    value: "Cannot edit this",
    disabled: true,
  },
};

export const Multiline: Story = {
  args: {
    label: "Description",
    placeholder: "Enter a description...",
    multiline: true,
    rows: 4,
  },
};

export const Required: Story = {
  args: {
    label: "Required Field",
    required: true,
    placeholder: "This field is required",
  },
};
