import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Box from "@mui/material/Box";
import MuiTypography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";

import { PageGrid, PageGridItem } from "../ui/PageGrid";

const meta = {
  title: "Components/PageGrid",
  component: PageGrid,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  argTypes: {
    spacing: {
      control: "number",
      description: "Gap between grid cells (theme spacing units)",
    },
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 1200 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof PageGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

const Cell = ({
  label,
  sublabel,
  height,
  color,
}: {
  label: string;
  sublabel?: string;
  height?: number | string;
  color?: string;
}) => (
  <Paper
    variant="outlined"
    sx={{
      p: 3,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: 120,
      height: height ?? "100%",
      bgcolor: color,
    }}
  >
    <MuiTypography variant="subtitle1" color="text.secondary">
      {label}
    </MuiTypography>
    {sublabel && (
      <MuiTypography variant="caption" color="text.disabled">
        {sublabel}
      </MuiTypography>
    )}
  </Paper>
);

export const TwoColumns: Story = {
  args: {
    columns: { xs: 1, md: 2 },
    spacing: 3,
    children: (
      <>
        <Cell label="Section A" />
        <Cell label="Section B" />
        <Cell label="Section C" />
        <Cell label="Section D" />
      </>
    ),
  },
};

export const ThreeColumns: Story = {
  args: {
    columns: { xs: 1, sm: 2, lg: 3 },
    spacing: 3,
    children: (
      <>
        <Cell label="1" />
        <Cell label="2" />
        <Cell label="3" />
        <Cell label="4" />
        <Cell label="5" />
        <Cell label="6" />
      </>
    ),
  },
};

export const SingleColumn: Story = {
  args: {
    columns: 1,
    spacing: 2,
    children: (
      <>
        <Cell label="Full Width A" />
        <Cell label="Full Width B" />
        <Cell label="Full Width C" />
      </>
    ),
  },
};

export const WithSpanning: Story = {
  args: {
    columns: { xs: 1, md: 3 },
    spacing: 3,
    children: (
      <>
        <PageGridItem span={{ xs: 1, md: 2 }}>
          <Cell label="Spans 2 columns" />
        </PageGridItem>
        <Cell label="1 col" />
        <Cell label="1 col" />
        <PageGridItem span={{ xs: 1, md: 2 }}>
          <Cell label="Spans 2 columns" />
        </PageGridItem>
      </>
    ),
  },
};

export const FullWidthRow: Story = {
  args: {
    columns: { xs: 1, md: 2 },
    spacing: 3,
    children: (
      <>
        <Cell label="Left" />
        <Cell label="Right" />
        <PageGridItem span={{ xs: 1, md: 2 }}>
          <Cell label="Full width row spanning all columns" />
        </PageGridItem>
      </>
    ),
  },
};

export const WithRowSpanning: Story = {
  args: {
    columns: { xs: 1, md: 3 },
    spacing: 3,
    children: (
      <>
        <PageGridItem rowSpan={{ xs: 1, md: 2 }}>
          <Cell label="Sidebar — spans 2 rows" />
        </PageGridItem>
        <Cell label="Top middle" />
        <Cell label="Top right" />
        <Cell label="Bottom middle" />
        <Cell label="Bottom right" />
      </>
    ),
  },
};

export const MixedSpanning: Story = {
  args: {
    columns: { xs: 1, md: 3 },
    spacing: 3,
    children: (
      <>
        <PageGridItem span={{ xs: 1, md: 2 }} rowSpan={{ xs: 1, md: 2 }}>
          <Cell label="Main content — 2 cols x 2 rows" />
        </PageGridItem>
        <Cell label="Side A" />
        <Cell label="Side B" />
        <PageGridItem span={{ xs: 1, md: 3 }}>
          <Cell label="Footer — full width" />
        </PageGridItem>
      </>
    ),
  },
};

/**
 * Dashboard-style layout demonstrating responsive span changes at every breakpoint.
 *
 * | Breakpoint | Columns | Layout description                                    |
 * |------------|---------|-------------------------------------------------------|
 * | xs (<600)  | 1       | All cells stack vertically, no spanning               |
 * | sm (600+)  | 2       | Hero 2-col wide; sidebar spans 2 rows; rest 1x1      |
 * | md (900+)  | 3       | Hero 2-col wide; sidebar spans 3 rows; chart 2-col   |
 * | lg (1200+) | 4       | Hero 3-col wide; sidebar spans 3 rows; chart 2-col   |
 */
export const ResponsiveDashboard: Story = {
  args: {
    columns: { xs: 1, sm: 2, md: 3, lg: 4 },
    spacing: 3,
    children: (
      <>
        {/* Row 1: Hero banner — grows wider with screen */}
        <PageGridItem span={{ xs: 1, sm: 2, md: 2, lg: 3 }}>
          <Cell
            label="Hero Banner"
            sublabel="xs:1  sm:2  md:2  lg:3 cols"
            color="action.hover"
          />
        </PageGridItem>

        {/* Row 1–3: Sidebar — gains row span on larger screens */}
        <PageGridItem rowSpan={{ xs: 1, sm: 2, md: 3, lg: 3 }}>
          <Cell
            label="Sidebar"
            sublabel="xs:1 row  sm:2 rows  md–lg:3 rows"
            color="action.selected"
          />
        </PageGridItem>

        {/* Row 2: Stats cards — single cells at every size */}
        <Cell label="Stat A" sublabel="1×1 at all sizes" />
        <Cell label="Stat B" sublabel="1×1 at all sizes" />

        {/* Row 2 (lg only) / Row 3 (md): Chart — column span grows */}
        <PageGridItem span={{ xs: 1, sm: 1, md: 2, lg: 2 }}>
          <Cell
            label="Chart"
            sublabel="xs–sm:1 col  md–lg:2 cols"
            color="action.hover"
          />
        </PageGridItem>

        {/* Row 3: Activity feed — takes remaining width */}
        <Cell label="Activity" sublabel="1×1 at all sizes" />

        {/* Row 4: Footer — always full width */}
        <PageGridItem span={{ xs: 1, sm: 2, md: 3, lg: 4 }}>
          <Cell
            label="Footer"
            sublabel="Always full width"
            color="action.hover"
          />
        </PageGridItem>
      </>
    ),
  },
};

export const TightSpacing: Story = {
  args: {
    columns: { xs: 1, sm: 2, md: 4 },
    spacing: 1,
    children: (
      <>
        {Array.from({ length: 8 }, (_, i) => (
          <Cell key={i} label={`${i + 1}`} />
        ))}
      </>
    ),
  },
};
