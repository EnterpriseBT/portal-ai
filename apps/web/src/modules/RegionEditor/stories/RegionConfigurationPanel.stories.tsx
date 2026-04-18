import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { RegionConfigurationPanelUI } from "../RegionConfigurationPanel.component";
import {
  ENTITY_OPTIONS,
  PROPOSED_REGIONS,
  DRIFT_REGIONS,
} from "./utils/region-editor-fixtures.util";
import type { EntityOption } from "../utils/region-editor.types";

const ENTITY_OPTIONS_WITH_STAGED: EntityOption[] = [
  ...ENTITY_OPTIONS,
  { value: "lead", label: "Lead", source: "staged" },
  { value: "campaign", label: "Campaign", source: "staged" },
];

const meta = {
  title: "Modules/RegionEditor/RegionConfigurationPanelUI",
  component: RegionConfigurationPanelUI,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: 320, minHeight: 560 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RegionConfigurationPanelUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  name: "Nothing selected",
  args: {
    region: null,
    entityOptions: ENTITY_OPTIONS,
    entityOrder: [],
    siblingsInSameEntity: 0,
    onUpdate: fn(),
    onDelete: fn(),
  },
};

export const StandardRegion: Story = {
  name: "Standard (rows-as-records)",
  args: {
    region: PROPOSED_REGIONS[0],
    entityOptions: ENTITY_OPTIONS,
    entityOrder: ["ent_contact", "ent_revenue", "ent_headcount"],
    siblingsInSameEntity: 0,
    onUpdate: fn(),
    onDelete: fn(),
  },
};

export const PivotedRegion: Story = {
  name: "Pivoted (columns-as-records) — axis name required",
  args: {
    region: PROPOSED_REGIONS.find((r) => r.id === "region_attrs_cols_as_regions")!,
    entityOptions: ENTITY_OPTIONS,
    entityOrder: ["ent_department"],
    siblingsInSameEntity: 0,
    onUpdate: fn(),
    onDelete: fn(),
    onSuggestAxisName: fn(),
  },
};

export const MessyPipelineSkipRules: Story = {
  name: "Skip rules — three active rules on a row-oriented region",
  args: {
    region: PROPOSED_REGIONS.find((r) => r.id === "region_messy_pipeline")!,
    entityOptions: ENTITY_OPTIONS,
    entityOrder: ["ent_deal"],
    siblingsInSameEntity: 0,
    onUpdate: fn(),
    onDelete: fn(),
  },
};

export const MessyQuartersSkipRules: Story = {
  name: "Skip rules — column-oriented region, cell-match targets a row",
  args: {
    region: PROPOSED_REGIONS.find((r) => r.id === "region_messy_quarters")!,
    entityOptions: ENTITY_OPTIONS,
    entityOrder: ["ent_department"],
    siblingsInSameEntity: 0,
    onUpdate: fn(),
    onDelete: fn(),
  },
};

export const CrosstabRegion: Story = {
  name: "Crosstab (cells-as-records) — two axis names required",
  args: {
    region: PROPOSED_REGIONS.find((r) => r.id === "region_revenue_crosstab_absolute")!,
    entityOptions: ENTITY_OPTIONS,
    entityOrder: ["ent_revenue"],
    siblingsInSameEntity: 0,
    onUpdate: fn(),
    onDelete: fn(),
    onSuggestAxisName: fn(),
  },
};

export const MergeBanner: Story = {
  name: "Binding to an entity with siblings",
  args: {
    region: { ...PROPOSED_REGIONS[0], targetEntityLabel: "Contact" },
    entityOptions: ENTITY_OPTIONS,
    entityOrder: ["ent_contact"],
    siblingsInSameEntity: 2,
    onUpdate: fn(),
    onDelete: fn(),
  },
};

export const DriftIdentityChanging: Story = {
  name: "Drift — identity changing",
  args: {
    region: DRIFT_REGIONS.find((r) => r.id === "region_revenue_crosstab_absolute")!,
    entityOptions: ENTITY_OPTIONS,
    entityOrder: ["ent_contact", "ent_revenue"],
    siblingsInSameEntity: 0,
    onUpdate: fn(),
    onDelete: fn(),
    onAcceptProposedIdentity: fn(),
    onKeepPriorIdentity: fn(),
    driftProposedIdentityLabel: "long month names",
  },
};

export const WithStagedAndCreate: Story = {
  name: "With staged entities + create-new affordance",
  args: {
    region: PROPOSED_REGIONS[0],
    entityOptions: ENTITY_OPTIONS_WITH_STAGED,
    entityOrder: ["ent_contact", "lead"],
    siblingsInSameEntity: 0,
    onUpdate: fn(),
    onDelete: fn(),
    onCreateEntity: ((key: string) => key) as (
      key: string,
      label: string
    ) => string,
  },
};
