import type { Meta, StoryObj } from "@storybook/react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { VisualFigureUI } from "../components/VisualFigure.component";

const meta = {
  title: "Components/VisualFigure",
  component: VisualFigureUI,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: {
    kind: "chart",
    title: "Revenue by month",
    summary:
      "Monthly revenue as bars. Revenue climbs through spring and peaks in June.",
    header: <Typography variant="subtitle2">Revenue by month</Typography>,
    children: (
      <Box sx={{ height: 160, bgcolor: "action.hover" }} aria-hidden="true" />
    ),
    testId: "visual-figure",
  },
} satisfies Meta<typeof VisualFigureUI>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A titled chart: named by its title, described by its summary. */
export const Chart: Story = {};

/** No title: the figure is named "Map". */
export const UntitledMap: Story = {
  args: {
    kind: "map",
    title: undefined,
    summary: "Map. 1,234 features in 1 layer (polygons); coloured by zoning.",
    header: null,
  },
};

/** With a data alternative behind the "Show data" disclosure. */
export const WithData: Story = {
  args: {
    data: <Typography variant="body2">The data table renders here.</Typography>,
  },
};
