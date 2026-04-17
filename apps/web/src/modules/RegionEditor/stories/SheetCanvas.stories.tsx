import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { SheetCanvasUI } from "../SheetCanvas.component";
import {
  DEMO_WORKBOOK,
  PROPOSED_REGIONS,
  DRIFT_REGIONS,
} from "../utils/region-editor-fixtures.util";

const meta = {
  title: "Modules/RegionEditor/SheetCanvasUI",
  component: SheetCanvasUI,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof SheetCanvasUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  name: "Empty sheet (draw here)",
  args: {
    sheet: DEMO_WORKBOOK.sheets[0],
    regions: [],
    entityOrder: [],
    selectedRegionId: null,
    onRegionSelect: fn(),
    onRegionDraft: fn(),
  },
};

export const WithRegions: Story = {
  name: "With proposed regions",
  args: {
    sheet: DEMO_WORKBOOK.sheets[0],
    regions: PROPOSED_REGIONS,
    entityOrder: [
      "ent_contact",
      "ent_deal",
      "ent_invoice",
      "ent_product",
      "ent_department",
      "ent_sales_rep",
      "ent_revenue",
      "ent_headcount",
    ],
    selectedRegionId: "region_leads_absolute",
    onRegionSelect: fn(),
    onRegionDraft: fn(),
  },
};

export const DriftHighlighted: Story = {
  name: "Drift-flagged regions (row table)",
  args: {
    sheet: DEMO_WORKBOOK.sheets[0],
    regions: DRIFT_REGIONS,
    entityOrder: [
      "ent_contact",
      "ent_deal",
      "ent_invoice",
      "ent_product",
      "ent_department",
      "ent_sales_rep",
      "ent_revenue",
      "ent_headcount",
    ],
    selectedRegionId: "region_opps_untilEmpty",
    onRegionSelect: fn(),
    onRegionDraft: fn(),
  },
};

export const CrosstabSheet: Story = {
  name: "Crosstab sheet (cells-as-records)",
  args: {
    sheet: DEMO_WORKBOOK.sheets[3],
    regions: PROPOSED_REGIONS,
    entityOrder: [
      "ent_contact",
      "ent_deal",
      "ent_invoice",
      "ent_product",
      "ent_department",
      "ent_sales_rep",
      "ent_revenue",
      "ent_headcount",
    ],
    selectedRegionId: "region_revenue_crosstab_absolute",
    onRegionSelect: fn(),
    onRegionDraft: fn(),
  },
};

export const MessyPipelineSkipRules: Story = {
  name: "Messy pipeline — skip blanks, section headers, subtotals",
  args: {
    sheet: DEMO_WORKBOOK.sheets.find((s) => s.id === "sheet_messy_pipeline")!,
    regions: PROPOSED_REGIONS,
    entityOrder: [
      "ent_contact",
      "ent_deal",
      "ent_invoice",
      "ent_product",
      "ent_department",
      "ent_sales_rep",
      "ent_revenue",
      "ent_headcount",
    ],
    selectedRegionId: "region_messy_pipeline",
    onRegionSelect: fn(),
    onRegionDraft: fn(),
  },
};

export const MessyQuartersSkipRules: Story = {
  name: "Messy quarters — skip subtotal columns (columns-as-records)",
  args: {
    sheet: DEMO_WORKBOOK.sheets.find((s) => s.id === "sheet_messy_quarters")!,
    regions: PROPOSED_REGIONS,
    entityOrder: [
      "ent_contact",
      "ent_deal",
      "ent_invoice",
      "ent_product",
      "ent_department",
      "ent_sales_rep",
      "ent_revenue",
      "ent_headcount",
    ],
    selectedRegionId: "region_messy_quarters",
    onRegionSelect: fn(),
    onRegionDraft: fn(),
  },
};

export const ReadOnly: Story = {
  name: "Read-only (no drawing)",
  args: {
    sheet: DEMO_WORKBOOK.sheets[0],
    regions: PROPOSED_REGIONS,
    entityOrder: [
      "ent_contact",
      "ent_deal",
      "ent_invoice",
      "ent_product",
      "ent_department",
      "ent_sales_rep",
      "ent_revenue",
      "ent_headcount",
    ],
    selectedRegionId: null,
    onRegionSelect: fn(),
    onRegionDraft: fn(),
    readOnly: true,
  },
};

interface InteractiveContentProps {
  initialRegions: typeof PROPOSED_REGIONS;
}

const InteractiveContent: React.FC<InteractiveContentProps> = ({ initialRegions }) => {
  const [regions, setRegions] = React.useState(initialRegions);
  const [selectedRegionId, setSelectedRegionId] = React.useState<string | null>(null);
  const sheet = DEMO_WORKBOOK.sheets[0];
  const entityOrder = Array.from(
    new Set(regions.map((r) => r.targetEntityDefinitionId).filter((id): id is string => Boolean(id)))
  );

  return (
    <SheetCanvasUI
      sheet={sheet}
      regions={regions}
      entityOrder={entityOrder}
      selectedRegionId={selectedRegionId}
      onRegionSelect={setSelectedRegionId}
      onRegionDraft={(bounds) => {
        const id = `region_${Date.now()}`;
        setRegions((prev) => [
          ...prev,
          {
            id,
            sheetId: sheet.id,
            bounds,
            orientation: "rows-as-records",
            headerAxis: "row",
            boundsMode: "absolute",
            targetEntityDefinitionId: null,
          },
        ]);
        setSelectedRegionId(id);
      }}
      onRegionResize={(regionId, nextBounds) => {
        setRegions((prev) =>
          prev.map((r) => (r.id === regionId ? { ...r, bounds: nextBounds } : r))
        );
      }}
    />
  );
};

export const InteractiveDrawing: Story = {
  name: "Interactive — draw new regions",
  args: {
    sheet: DEMO_WORKBOOK.sheets[0],
    regions: [],
    entityOrder: [],
    selectedRegionId: null,
    onRegionSelect: fn(),
    onRegionDraft: fn(),
  },
  render: () => <InteractiveContent initialRegions={[]} />,
};
