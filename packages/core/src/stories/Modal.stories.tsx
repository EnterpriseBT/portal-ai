import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
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
    maximizable: {
      control: "boolean",
      description:
        "Surfaces a maximize/restore toggle in the header. Use for modals hosting large workflows.",
    },
    defaultMaximized: {
      control: "boolean",
      description:
        "Initial maximized state when `maximizable` is true. Ignored when the toggle is off.",
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
    children: <Typography>This is the modal content.</Typography>,
  },
};

export const WithActions: Story = {
  args: {
    open: true,
    onClose: () => {},
    title: "Confirm Action",
    children: <Typography>Are you sure you want to proceed?</Typography>,
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
    children: <Typography>You must acknowledge this message.</Typography>,
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

// ──────────────────────────────────────────────────────────────────
// Maximize variants
//
// `maximizable` surfaces a header toggle that flips the dialog into
// MUI's `fullScreen` mode. `defaultMaximized` controls the initial state.
// ──────────────────────────────────────────────────────────────────

const PlaceholderContent: React.FC<{ rows?: number }> = ({ rows = 8 }) => (
  <Stack spacing={2}>
    <Typography>
      Pretend this is a multi-step workflow with a large region editor, a tab
      strip, and per-sheet canvases. Use the maximize button in the header to
      give the workflow more room.
    </Typography>
    {Array.from({ length: rows }).map((_, i) => (
      <Box
        key={i}
        sx={{
          height: 80,
          borderRadius: 1,
          bgcolor: "action.hover",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "text.secondary",
        }}
      >
        Placeholder block #{i + 1}
      </Box>
    ))}
  </Stack>
);

export const Maximizable: Story = {
  args: {
    open: true,
    onClose: () => {},
    title: "Region editor",
    maximizable: true,
    maxWidth: "lg",
    fullWidth: true,
    children: <PlaceholderContent />,
  },
};

export const StartsMaximized: Story = {
  args: {
    open: true,
    onClose: () => {},
    title: "Large workflow (full screen by default)",
    maximizable: true,
    defaultMaximized: true,
    children: <PlaceholderContent rows={12} />,
  },
};

export const MaximizableWithActions: Story = {
  args: {
    open: true,
    onClose: () => {},
    title: "Confirm import",
    maximizable: true,
    maxWidth: "md",
    fullWidth: true,
    children: <PlaceholderContent rows={5} />,
    actions: (
      <>
        <Button variant="text">Cancel</Button>
        <Button variant="contained">Commit</Button>
      </>
    ),
  },
};

const InteractiveMaximizableRender = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open maximizable modal</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Interactive maximizable modal"
        maximizable
        maxWidth="lg"
        fullWidth
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
        <PlaceholderContent rows={6} />
      </Modal>
    </>
  );
};

export const InteractiveMaximizable: Story = {
  args: {
    open: false,
    onClose: () => {},
  },
  render: InteractiveMaximizableRender,
};
