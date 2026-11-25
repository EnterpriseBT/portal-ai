import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import type { AssignedEntityTag } from "@portalai/core/contracts";

import { TagsDialogUI } from "../components/TagsDialog.component";

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
  title: "Components/TagsDialog",
  component: TagsDialogUI,
  args: {
    open: true,
    onClose: fn(),
    name: "Sales",
    tags: [tag("t1", "Finance", "#2563EB"), tag("t2", "Q4", null)],
    onAssign: fn(),
    onUnassign: fn(),
    onSearch: async () => [
      { value: "t3", label: "Marketing" },
      { value: "t4", label: "Archived" },
    ],
  },
} satisfies Meta<typeof TagsDialogUI>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The object's tags, removable, and the picker. */
export const WithTags: Story = {};

/** An untagged object: just the picker. */
export const NoTags: Story = { args: { tags: [] } };

/** A caller who can't read tags (#630). */
export const NoTagRead: Story = { args: { canReadTags: false } };
