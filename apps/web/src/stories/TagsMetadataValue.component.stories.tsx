import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import type { AssignedEntityTag } from "@portalai/core/contracts";

import { TagsMetadataValueUI } from "../components/TagsMetadataValue.component";

const tag = (
  id: string,
  name: string,
  color: string | null
): AssignedEntityTag => ({
  id,
  assignmentId: `assignment-${id}`,
  organizationId: "org-1",
  name,
  color,
  description: null,
  sourcePortalId: null,
  created: 1710000000000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
});

const meta = {
  title: "Components/TagsMetadataValue",
  component: TagsMetadataValueUI,
  parameters: { layout: "padded" },
  args: {
    tags: [tag("t1", "Finance", "#2563EB"), tag("t2", "Q4", null)],
    editGate: { kind: "allow" },
    onEdit: fn(),
    name: "Sales",
  },
} satisfies Meta<typeof TagsMetadataValueUI>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A writer: read-only chips, then Edit. */
export const Writer: Story = {};

/** A writer on an untagged object: "No tags", then Edit. */
export const WriterNoTags: Story = { args: { tags: [] } };

/** A reader: the chips alone. */
export const Reader: Story = { args: { editGate: { kind: "hide" } } };
