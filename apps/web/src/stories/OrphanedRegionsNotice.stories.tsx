import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { OrphanedRegionsNoticeUI } from "../components/OrphanedRegionsNotice.component";

const meta = {
  title: "Components/OrphanedRegionsNoticeUI",
  component: OrphanedRegionsNoticeUI,
  args: {
    orphans: [
      {
        region: { id: "r1" } as never,
        sheetName: "Q3",
        boundsA1: "B2:F40",
        targetEntityLabel: "Contacts",
      },
      {
        region: { id: "r2" } as never,
        sheetName: "Q4 (old)",
        boundsA1: "A1:C9",
        targetEntityLabel: "Deals",
      },
    ],
    sheets: [
      { id: "s1", name: "Q1" },
      { id: "s2", name: "Q2" },
    ],
    attempted: false,
    onMove: fn(),
    onDelete: fn(),
  },
} satisfies Meta<typeof OrphanedRegionsNoticeUI>;

export default meta;
type Story = StoryObj<typeof meta>;

/** #1009: regions whose sheet was deleted or renamed at the source. */
export const Default: Story = {
  name: "Regions whose sheet is missing (#1009)",
};

/** #1009: after Interpret was refused while they remain. */
export const AfterInterpret: Story = {
  name: "After a refused Interpret (#1009)",
  args: { attempted: true },
};
