import React, { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { RegionDrawingStep } from "../RegionDrawingStep.component";
import {
  DEMO_WORKBOOK,
  ENTITY_OPTIONS,
  EMPTY_REGIONS,
  PROPOSED_REGIONS,
  DRIFT_REGIONS,
} from "../utils/region-editor-fixtures.util";
import type { CellBounds, RegionDraft } from "../utils/region-editor.types";

const meta = {
  title: "Modules/RegionEditor/RegionDrawingStep",
  component: RegionDrawingStep,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ padding: 16, display: "flex" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof RegionDrawingStep>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  name: "Empty — no regions drawn",
  args: {
    workbook: DEMO_WORKBOOK,
    regions: EMPTY_REGIONS,
    activeSheetId: DEMO_WORKBOOK.sheets[0].id,
    onActiveSheetChange: fn(),
    selectedRegionId: null,
    onSelectRegion: fn(),
    onRegionDraft: fn(),
    onRegionUpdate: fn(),
    onRegionDelete: fn(),
    entityOptions: ENTITY_OPTIONS,
    onInterpret: fn(),
    onRefetchWorkbook: fn(),
  },
};

export const WithProposedRegions: Story = {
  name: "Regions proposed — one selected",
  args: {
    workbook: DEMO_WORKBOOK,
    regions: PROPOSED_REGIONS,
    activeSheetId: DEMO_WORKBOOK.sheets[0].id,
    onActiveSheetChange: fn(),
    selectedRegionId: "region_leads_absolute",
    onSelectRegion: fn(),
    onRegionDraft: fn(),
    onRegionUpdate: fn(),
    onRegionDelete: fn(),
    entityOptions: ENTITY_OPTIONS,
    onSuggestAxisName: fn(),
    onInterpret: fn(),
    onRefetchWorkbook: fn(),
  },
};

export const MessyPipelineSkipRules: Story = {
  name: "Messy pipeline — row skip rules (separators + subtotals)",
  args: {
    workbook: DEMO_WORKBOOK,
    regions: PROPOSED_REGIONS,
    activeSheetId: "sheet_messy_pipeline",
    onActiveSheetChange: fn(),
    selectedRegionId: "region_messy_pipeline",
    onSelectRegion: fn(),
    onRegionDraft: fn(),
    onRegionUpdate: fn(),
    onRegionDelete: fn(),
    entityOptions: ENTITY_OPTIONS,
    onInterpret: fn(),
    onRefetchWorkbook: fn(),
  },
};

export const MessyQuartersSkipRules: Story = {
  name: "Messy quarters — column skip rules (subtotal columns)",
  args: {
    workbook: DEMO_WORKBOOK,
    regions: PROPOSED_REGIONS,
    activeSheetId: "sheet_messy_quarters",
    onActiveSheetChange: fn(),
    selectedRegionId: "region_messy_quarters",
    onSelectRegion: fn(),
    onRegionDraft: fn(),
    onRegionUpdate: fn(),
    onRegionDelete: fn(),
    entityOptions: ENTITY_OPTIONS,
    onInterpret: fn(),
    onRefetchWorkbook: fn(),
  },
};

export const CrosstabSelected: Story = {
  name: "Crosstab region selected (cells-as-records)",
  args: {
    workbook: DEMO_WORKBOOK,
    regions: PROPOSED_REGIONS,
    activeSheetId: "sheet_crosstab",
    onActiveSheetChange: fn(),
    selectedRegionId: "region_revenue_crosstab_absolute",
    onSelectRegion: fn(),
    onRegionDraft: fn(),
    onRegionUpdate: fn(),
    onRegionDelete: fn(),
    entityOptions: ENTITY_OPTIONS,
    onSuggestAxisName: fn(),
    onInterpret: fn(),
    onRefetchWorkbook: fn(),
  },
};

export const DriftSeeded: Story = {
  name: "Drift-seeded — identity-changing crosstab region",
  args: {
    workbook: DEMO_WORKBOOK,
    regions: DRIFT_REGIONS,
    activeSheetId: "sheet_crosstab",
    onActiveSheetChange: fn(),
    selectedRegionId: "region_revenue_crosstab_absolute",
    onSelectRegion: fn(),
    onRegionDraft: fn(),
    onRegionUpdate: fn(),
    onRegionDelete: fn(),
    entityOptions: ENTITY_OPTIONS,
    onAcceptProposedIdentity: fn(),
    onKeepPriorIdentity: fn(),
    onInterpret: fn(),
    onRefetchWorkbook: fn(),
  },
};

const InteractiveContent: React.FC = () => {
  const [regions, setRegions] = useState<RegionDraft[]>([]);
  const [activeSheetId, setActiveSheetId] = useState(DEMO_WORKBOOK.sheets[0].id);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);

  const handleDraft = (draft: { sheetId: string; bounds: CellBounds }) => {
    const id = `region_${Date.now()}`;
    setRegions((prev) => [
      ...prev,
      {
        id,
        sheetId: draft.sheetId,
        bounds: draft.bounds,
        orientation: "rows-as-records",
        headerAxis: "row",
        boundsMode: "absolute",
        targetEntityDefinitionId: null,
      },
    ]);
    setSelectedRegionId(id);
  };

  const handleUpdate = (regionId: string, updates: Partial<RegionDraft>) => {
    setRegions((prev) =>
      prev.map((r) => (r.id === regionId ? { ...r, ...updates } : r))
    );
  };

  const handleDelete = (regionId: string) => {
    setRegions((prev) => prev.filter((r) => r.id !== regionId));
    setSelectedRegionId((sel) => (sel === regionId ? null : sel));
  };

  const handleResize = (regionId: string, nextBounds: CellBounds) => {
    setRegions((prev) =>
      prev.map((r) => (r.id === regionId ? { ...r, bounds: nextBounds } : r))
    );
  };

  const entityOptions = useMemo(() => ENTITY_OPTIONS, []);

  return (
    <RegionDrawingStep
      workbook={DEMO_WORKBOOK}
      regions={regions}
      activeSheetId={activeSheetId}
      onActiveSheetChange={setActiveSheetId}
      selectedRegionId={selectedRegionId}
      onSelectRegion={setSelectedRegionId}
      onRegionDraft={handleDraft}
      onRegionUpdate={handleUpdate}
      onRegionDelete={handleDelete}
      onRegionResize={handleResize}
      entityOptions={entityOptions}
      onSuggestAxisName={(id) =>
        handleUpdate(id, {
          recordsAxisName: { name: "Month", source: "ai", confidence: 0.82 },
        })
      }
      onInterpret={fn()}
      onRefetchWorkbook={fn()}
    />
  );
};

export const Interactive: Story = {
  name: "Interactive — draw, bind, merge",
  args: {
    workbook: DEMO_WORKBOOK,
    regions: [],
    activeSheetId: DEMO_WORKBOOK.sheets[0].id,
    onActiveSheetChange: fn(),
    selectedRegionId: null,
    onSelectRegion: fn(),
    onRegionDraft: fn(),
    onRegionUpdate: fn(),
    onRegionDelete: fn(),
    entityOptions: ENTITY_OPTIONS,
    onInterpret: fn(),
  },
  render: () => <InteractiveContent />,
};
