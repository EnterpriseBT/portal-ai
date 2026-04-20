import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import type { EntityTag } from "@portalai/core/models";

import {
  TagFormModal,
  TagFormModalProps,
} from "../components/TagFormModal.component";

const existingTag: EntityTag = {
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
  title: "Components/TagFormModal",
  component: TagFormModal,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    open: true,
    onClose: fn(),
    onSubmit: fn(),
    isPending: false,
    serverError: null,
    tag: null,
  },
} satisfies Meta<typeof TagFormModal>;

export default meta;
type Story = StoryObj<TagFormModalProps>;

export const CreateMode: Story = {
  args: {
    tag: null,
  },
};

export const EditMode: Story = {
  args: {
    tag: existingTag,
  },
};

export const Submitting: Story = {
  args: {
    tag: null,
    isPending: true,
  },
};

export const ServerError: Story = {
  args: {
    tag: null,
    serverError: {
      message:
        "An entity tag with this name already exists in this organization",
      code: "ENTITY_TAG_DUPLICATE_NAME",
    },
  },
};

export const EditWithServerError: Story = {
  args: {
    tag: existingTag,
    serverError: {
      message:
        "An entity tag with this name already exists in this organization",
      code: "ENTITY_TAG_DUPLICATE_NAME",
    },
  },
};
