import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import type { EntityTag } from "@portalai/core/models";

import { TagCardUI, TagCardUIProps } from "../components/TagCard.component";

const baseTag: EntityTag = {
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
  title: "Components/TagCardUI",
  component: TagCardUI,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    onEdit: fn(),
    onDelete: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ width: 480 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TagCardUI>;

export default meta;
type Story = StoryObj<TagCardUIProps>;

export const Default: Story = {
  args: {
    tag: baseTag,
  },
};

export const WithoutColor: Story = {
  args: {
    tag: {
      ...baseTag,
      id: "tag-002",
      name: "Staging",
      color: null,
      description: "Pre-production staging environment",
    },
  },
};

export const WithoutDescription: Story = {
  args: {
    tag: {
      ...baseTag,
      id: "tag-003",
      name: "Deprecated",
      color: "#F59E0B",
      description: null,
    },
  },
};

export const MinimalTag: Story = {
  args: {
    tag: {
      ...baseTag,
      id: "tag-004",
      name: "Misc",
      color: null,
      description: null,
    },
  },
};

export const LongName: Story = {
  args: {
    tag: {
      ...baseTag,
      id: "tag-005",
      name: "This Is A Very Long Tag Name That Should Be Truncated In The Card",
      color: "#3B82F6",
      description:
        "This is an equally long description that should also be truncated when it overflows the card width",
    },
  },
};
