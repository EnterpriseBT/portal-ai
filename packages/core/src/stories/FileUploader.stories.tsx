import type { Meta, StoryObj } from "@storybook/react";
import { FileUploader } from "../ui/FileUploader";

const meta = {
  title: "Components/Form/FileUploader",
  component: FileUploader,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    accept: {
      control: "text",
      description: "Accepted file types (e.g., '.png,.jpg')",
    },
    multiple: {
      control: "boolean",
      description: "Whether multiple files can be selected",
    },
    maxSizeMB: {
      control: "number",
      description: "Maximum file size in megabytes",
    },
    disabled: {
      control: "boolean",
      description: "Whether the uploader is disabled",
    },
    helperText: {
      control: "text",
      description: "Helper text displayed below the uploader",
    },
    error: {
      control: "boolean",
      description: "Whether to display an error state",
    },
  },
} satisfies Meta<typeof FileUploader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const WithAcceptedTypes: Story = {
  args: {
    accept: ".png,.jpg,.jpeg,.gif",
    helperText: "Upload an image file",
  },
};

export const Multiple: Story = {
  args: {
    multiple: true,
    helperText: "You can upload multiple files",
  },
};

export const WithMaxSize: Story = {
  args: {
    maxSizeMB: 5,
    helperText: "Maximum file size: 5MB",
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    helperText: "File upload is currently disabled",
  },
};

export const ErrorState: Story = {
  args: {
    error: true,
    helperText: "Please upload a valid file",
  },
};
