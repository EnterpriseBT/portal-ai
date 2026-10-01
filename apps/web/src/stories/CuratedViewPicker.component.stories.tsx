import type { Meta, StoryObj } from "@storybook/react";
import type { SelectOption } from "@portalai/core/ui";

import { CuratedViewPickerUI } from "../components/CuratedViewPicker.component";

const VIEWS: SelectOption[] = [
  { value: "cv-1", label: "Q3 orders" },
  { value: "cv-2", label: "Active customers" },
  { value: "cv-3", label: "Open invoices" },
];

const fetchOptions = async (query: string): Promise<SelectOption[]> =>
  VIEWS.filter((v) => v.label.toLowerCase().includes(query.toLowerCase()));

const meta = {
  title: "Components/CuratedViewPicker",
  component: CuratedViewPickerUI,
  tags: ["autodocs"],
  args: { selected: [], onChange: () => {}, fetchOptions },
} satisfies Meta<typeof CuratedViewPickerUI>;

export default meta;
type Story = StoryObj<typeof meta>;

/** #674: searches the views the viewer can read; the hint shows until one is picked. */
export const Empty: Story = {
  args: {
    helperText:
      "No views selected — this station won't have data to query until a view is attached.",
  },
};

export const WithSelection: Story = {
  args: { selected: ["cv-1", "cv-2"] },
};

/** A seeded selection the search doesn't return, labelled from the station GET. */
export const Seeded: Story = {
  args: {
    selected: ["cv-9"],
    selectedLabels: { "cv-9": "Archived regions" },
  },
};
