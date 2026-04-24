import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { RegionConfigurationPanelUI } from "../RegionConfigurationPanel.component";
import {
  ENTITY_OPTIONS,
  PROPOSED_REGIONS,
  DRIFT_REGIONS,
} from "./utils/region-editor-fixtures.util";
import type {
  EntityOption,
  RegionDraft,
} from "../utils/region-editor.types";

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

// ── Plan-specified PR-4 stories: Tidy / Pivoted / Crosstab ───────────────

const TIDY_REGION: RegionDraft = {
  id: "tidy",
  sheetId: "sheet_row_tables",
  bounds: { startRow: 0, endRow: 9, startCol: 0, endCol: 3 },
  proposedLabel: "Contacts",
  targetEntityDefinitionId: "ent_contact",
  targetEntityLabel: "Contact",
  headerAxes: ["row"],
  segmentsByAxis: {
    row: [{ kind: "field", positionCount: 4 }],
  },
};

const PIVOTED_REGION: RegionDraft = {
  id: "pivoted",
  sheetId: "sheet_pivoted",
  bounds: { startRow: 0, endRow: 5, startCol: 0, endCol: 3 },
  proposedLabel: "Monthly metrics",
  targetEntityDefinitionId: "ent_revenue",
  targetEntityLabel: "Revenue",
  headerAxes: ["row"],
  segmentsByAxis: {
    row: [
      {
        kind: "pivot",
        id: "pivoted-row",
        axisName: "Month",
        axisNameSource: "user",
        positionCount: 4,
      },
    ],
  },
  cellValueField: { name: "Revenue", nameSource: "user" },
  axisAnchorCell: { row: 0, col: 0 },
};

const CROSSTAB_REGION: RegionDraft = {
  id: "crosstab",
  sheetId: "sheet_crosstab",
  bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 4 },
  proposedLabel: "Revenue by region × quarter",
  targetEntityDefinitionId: "ent_revenue_crosstab",
  targetEntityLabel: "Revenue (crosstab)",
  headerAxes: ["row", "column"],
  segmentsByAxis: {
    row: [
      { kind: "skip", positionCount: 1 },
      {
        kind: "pivot",
        id: "crosstab-row",
        axisName: "Quarter",
        axisNameSource: "user",
        positionCount: 4,
      },
    ],
    column: [
      { kind: "skip", positionCount: 1 },
      {
        kind: "pivot",
        id: "crosstab-col",
        axisName: "Region",
        axisNameSource: "user",
        positionCount: 4,
      },
    ],
  },
  cellValueField: { name: "Revenue", nameSource: "user" },
  axisAnchorCell: { row: 0, col: 0 },
};

const CROSSTAB_DYNAMIC_REGION: RegionDraft = {
  ...CROSSTAB_REGION,
  id: "crosstab-dynamic",
  segmentsByAxis: {
    row: [
      { kind: "skip", positionCount: 1 },
      {
        kind: "pivot",
        id: "crosstab-row-dynamic",
        axisName: "Quarter",
        axisNameSource: "user",
        positionCount: 4,
        dynamic: {
          terminator: { kind: "untilBlank", consecutiveBlanks: 2 },
        },
      },
    ],
    column: CROSSTAB_REGION.segmentsByAxis!.column!,
  },
};

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

export const Tidy: Story = {
  name: "Tidy (classic) — single row axis, field segment",
  args: {
    region: TIDY_REGION,
    entityOptions: ENTITY_OPTIONS,
    entityOrder: ["ent_contact"],
    siblingsInSameEntity: 0,
    onUpdate: fn(),
    onDelete: fn(),
  },
};

export const Pivoted: Story = {
  name: "Pivoted — one pivot segment, cell-value field required",
  args: {
    region: PIVOTED_REGION,
    entityOptions: ENTITY_OPTIONS,
    entityOrder: ["ent_revenue"],
    siblingsInSameEntity: 0,
    onUpdate: fn(),
    onDelete: fn(),
  },
};

export const Crosstab: Story = {
  name: "Crosstab — both axes pivoted, cell-value field visible",
  args: {
    region: CROSSTAB_REGION,
    entityOptions: ENTITY_OPTIONS,
    entityOrder: ["ent_revenue_crosstab"],
    siblingsInSameEntity: 0,
    onUpdate: fn(),
    onDelete: fn(),
  },
};

export const CrosstabDynamicTail: Story = {
  name: "Crosstab with dynamic tail pivot (row axis grows)",
  args: {
    region: CROSSTAB_DYNAMIC_REGION,
    entityOptions: ENTITY_OPTIONS,
    entityOrder: ["ent_revenue_crosstab"],
    siblingsInSameEntity: 0,
    onUpdate: fn(),
    onDelete: fn(),
  },
};

// ── Existing scenarios retained for regression coverage ──────────────────

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

export const MergeBanner: Story = {
  name: "Binding to an entity with siblings",
  args: {
    region: { ...TIDY_REGION, targetEntityLabel: "Contact" },
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
    region: DRIFT_REGIONS.find(
      (r) => r.id === "region_revenue_crosstab_absolute"
    )!,
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
    region: TIDY_REGION,
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
