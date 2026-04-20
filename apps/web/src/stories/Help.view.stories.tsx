import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { HelpViewUI, type HelpViewUIProps } from "../views/Help.view";
import { GETTING_STARTED_STEPS } from "../utils/getting-started.util";
import {
  GLOSSARY_ENTRIES,
  filterGlossary,
  GlossaryCategory,
} from "../utils/glossary.util";
import { FAQ_ENTRIES } from "../utils/faq.util";

const meta = {
  title: "Views/HelpView",
  component: HelpViewUI,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    steps: GETTING_STARTED_STEPS,
    glossaryEntries: GLOSSARY_ENTRIES,
    faqEntries: FAQ_ENTRIES,
    onNavigate: fn(),
  },
} satisfies Meta<typeof HelpViewUI>;

export default meta;
type Story = StoryObj<HelpViewUIProps>;

export const Default: Story = {};

export const GlossaryFilteredToAnalytics: Story = {
  args: {
    glossaryEntries: filterGlossary(GLOSSARY_ENTRIES, {
      category: GlossaryCategory.Analytics,
    }),
  },
};

export const Empty: Story = {
  args: {
    steps: [],
    glossaryEntries: [],
    faqEntries: [],
  },
};
