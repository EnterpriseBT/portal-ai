import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import type { EntityTag } from "@portalai/core/models";

import {
  DeleteTagDialog,
  DeleteTagDialogProps,
} from "../components/DeleteTagDialog.component";

const sampleTag: EntityTag = {
  id: "tag-001",
  organizationId: "org-1",
  name: "Production",
  color: "#EF4444",
  description: "Resources running in the production environment",
  created: 1710000000000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const meta = {
  title: "Components/DeleteTagDialog",
  component: DeleteTagDialog,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    open: true,
    onClose: fn(),
    onConfirm: fn(),
    isPending: false,
    tag: sampleTag,
  },
} satisfies Meta<typeof DeleteTagDialog>;

export default meta;
type Story = StoryObj<DeleteTagDialogProps>;

export const Default: Story = {
  args: {},
};

export const Deleting: Story = {
  args: {
    isPending: true,
  },
};

export const DifferentTag: Story = {
  args: {
    tag: {
      ...sampleTag,
      id: "tag-002",
      name: "Staging",
      color: "#F59E0B",
    },
  },
};
