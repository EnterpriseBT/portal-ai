import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import {
  FAQList,
  type FAQListProps,
} from "../components/FAQList.component";
import { FAQ_ENTRIES, FAQCategory, filterFAQ } from "../utils/faq.util";

const meta = {
  title: "Components/FAQList",
  component: FAQList,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    onSelectTerm: fn(),
  },
} satisfies Meta<typeof FAQList>;

export default meta;
type Story = StoryObj<FAQListProps>;

export const Default: Story = {
  args: {
    entries: FAQ_ENTRIES,
  },
};

export const GroupedByCategory: Story = {
  args: {
    entries: FAQ_ENTRIES,
    groupByCategory: true,
  },
};

export const FilteredToJobs: Story = {
  args: {
    entries: filterFAQ(FAQ_ENTRIES, { category: FAQCategory.Jobs }),
  },
};

export const Empty: Story = {
  args: {
    entries: [],
  },
};
