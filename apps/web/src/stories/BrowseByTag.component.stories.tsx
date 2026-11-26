import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { BrowseByTagUI } from "../components/BrowseByTag.component";
import { TAG_COUNTS, TAG_MATCHES } from "./dashboard-fixtures";
import { BrowseByTagExample } from "./dashboard-tile-fixtures";

/** #1123: the dashboard's Browse by tag. Press a tag to list what has it. */
const meta = {
  title: "Dashboard/BrowseByTag",
  component: BrowseByTagUI,
  parameters: { layout: "padded" },
  args: {
    tags: TAG_COUNTS,
    selectedTagId: null,
    onSelectTag: fn(),
  },
} satisfies Meta<typeof BrowseByTagUI>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Interactive: press a tag to show its matches, again to hide them. */
export const Populated: Story = { render: () => <BrowseByTagExample /> };
/** A tag pressed, its matches listed with their types' icons. */
export const TagSelected: Story = {
  args: { selectedTagId: "t2", matches: TAG_MATCHES.t2 },
};
export const MatchesLoading: Story = {
  args: { selectedTagId: "t1", matchesStatus: "loading" },
};
export const MatchesError: Story = {
  args: { selectedTagId: "t1", matchesStatus: "error" },
};
export const Empty: Story = { args: { tags: [] } };
