import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import type { AssignedEntityTag } from "@portalai/core/contracts";

import { TagsSectionUI } from "../components/TagsSection.component";

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
  created: 1710000000000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
});

const meta = {
  title: "Components/TagsSection",
  component: TagsSectionUI,
  parameters: { layout: "padded" },
  args: {
    tags: [tag("t1", "Finance", "#2563EB"), tag("t2", "Q4", null)],
    gate: { kind: "allow" },
    onAssign: fn(),
    onUnassign: fn(),
    onSearch: async () => [
      { value: "t3", label: "Marketing" },
      { value: "t4", label: "Archived" },
    ],
  },
} satisfies Meta<typeof TagsSectionUI>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A caller with write on the object: removable chips and the picker. */
export const Editable: Story = {};

/** A caller with write on an untagged object: just the picker. */
export const EditableEmpty: Story = { args: { tags: [] } };

/** A read-only caller: the chips alone. */
export const ReadOnly: Story = { args: { gate: { kind: "hide" } } };
