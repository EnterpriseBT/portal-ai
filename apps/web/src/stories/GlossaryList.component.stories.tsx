import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import {
  GlossaryList,
  type GlossaryListProps,
} from "../components/GlossaryList.component";
import {
  GLOSSARY_ENTRIES,
  GlossaryCategory,
  filterGlossary,
} from "../utils/glossary.util";

const meta = {
  title: "Components/GlossaryList",
  component: GlossaryList,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    onSelectTerm: fn(),
  },
} satisfies Meta<typeof GlossaryList>;

export default meta;
type Story = StoryObj<GlossaryListProps>;

export const Default: Story = {
  args: {
    entries: GLOSSARY_ENTRIES,
  },
};

export const FilteredToAnalytics: Story = {
  args: {
    entries: filterGlossary(GLOSSARY_ENTRIES, {
      category: GlossaryCategory.Analytics,
    }),
  },
};

export const Empty: Story = {
  args: {
    entries: [],
  },
};
