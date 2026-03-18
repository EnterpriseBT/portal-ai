import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import Typography from "@mui/material/Typography";

const meta = {
  title: "Components/Modal",
  component: Modal,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    open: {
      control: "boolean",
      description: "Whether the modal is open",
    },
    title: {
      control: "text",
      description: "Title displayed in the modal header",
    },
    showCloseButton: {
      control: "boolean",
      description: "Whether to show the close button",
    },
    maxWidth: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
      description: "Maximum width of the modal",
    },
    fullWidth: {
      control: "boolean",
      description: "Whether the modal should take up the full width",
    },
  },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: true,
    onClose: () => {},
    title: "Modal Title",
    children: (
      <Typography>This is the modal content.</Typography>
    ),
  },
};

export const WithActions: Story = {
  args: {
    open: true,
    onClose: () => {},
    title: "Confirm Action",
    children: (
      <Typography>Are you sure you want to proceed?</Typography>
    ),
    actions: (
      <>
        <Button variant="text">Cancel</Button>
        <Button variant="contained">Confirm</Button>
      </>
    ),
  },
};

export const NoCloseButton: Story = {
  args: {
    open: true,
    onClose: () => {},
    title: "Important Notice",
    showCloseButton: false,
    children: (
      <Typography>You must acknowledge this message.</Typography>
    ),
    actions: <Button variant="contained">Acknowledge</Button>,
  },
};

const InteractiveRender = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open Modal</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Interactive Modal"
        actions={
          <>
            <Button variant="text" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="contained" onClick={() => setOpen(false)}>
              Save
            </Button>
          </>
        }
      >
        <Typography>Click the buttons to interact with this modal.</Typography>
      </Modal>
    </>
  );
};

export const Interactive: Story = {
  args: {
    open: false,
    onClose: () => {},
  },
  render: InteractiveRender,
};
