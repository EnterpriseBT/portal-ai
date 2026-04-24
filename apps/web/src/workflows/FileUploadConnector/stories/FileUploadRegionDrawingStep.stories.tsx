import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { FileUploadRegionDrawingStepUI } from "../FileUploadRegionDrawingStep.component";
import {
  DEMO_WORKBOOK,
  ENTITY_OPTIONS,
  SAMPLE_REGIONS,
} from "../utils/file-upload-fixtures.util";
import type { RegionDraft } from "../../../modules/RegionEditor";

const FIRST_SHEET_ID = DEMO_WORKBOOK.sheets[0].id;
const FIRST_REGION = SAMPLE_REGIONS[0];

const meta = {
  title: "Workflows/FileUploadConnector/FileUploadRegionDrawingStepUI",
  component: FileUploadRegionDrawingStepUI,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ padding: 16, display: "flex", flexDirection: "column" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    onActiveSheetChange: fn(),
    onSelectRegion: fn(),
    onRegionDraft: fn(),
    onRegionUpdate: fn(),
    onRegionDelete: fn(),
    onInterpret: fn(),
    entityOptions: ENTITY_OPTIONS,
  },
} satisfies Meta<typeof FileUploadRegionDrawingStepUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  name: "Empty — just-parsed workbook, no regions",
  args: {
    workbook: DEMO_WORKBOOK,
    regions: [],
    activeSheetId: FIRST_SHEET_ID,
    selectedRegionId: null,
    serverError: null,
  },
};

export const OneRegion_Valid: Story = {
  name: "One region drawn and bound — Interpret enabled",
  args: {
    workbook: DEMO_WORKBOOK,
    regions: [FIRST_REGION],
    activeSheetId: FIRST_REGION.sheetId,
    selectedRegionId: FIRST_REGION.id,
    serverError: null,
  },
};

const mergedSecondRegion: RegionDraft = {
  ...SAMPLE_REGIONS[1],
  targetEntityDefinitionId: FIRST_REGION.targetEntityDefinitionId,
  targetEntityLabel: FIRST_REGION.targetEntityLabel,
};

export const MultipleRegions_MergedEntity: Story = {
  name: "Two regions bound to the same entity — merge banner visible",
  args: {
    workbook: DEMO_WORKBOOK,
    regions: [FIRST_REGION, mergedSecondRegion],
    activeSheetId: FIRST_REGION.sheetId,
    selectedRegionId: mergedSecondRegion.id,
    serverError: null,
  },
};

const invalidRegion: RegionDraft = {
  id: "r_invalid_demo",
  sheetId: FIRST_SHEET_ID,
  bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 3 },
  headerAxes: ["row"],
  segmentsByAxis: { row: [{ kind: "field", positionCount: 4 }] },
  targetEntityDefinitionId: null,
};

export const InvalidRegion_AttemptedInterpret: Story = {
  name: "Invalid region — consumer-injected errors shown after Interpret click",
  args: {
    workbook: DEMO_WORKBOOK,
    regions: [invalidRegion],
    activeSheetId: invalidRegion.sheetId,
    selectedRegionId: invalidRegion.id,
    serverError: null,
    errors: {
      [invalidRegion.id]: {
        targetEntityDefinitionId: "Select an entity to bind this region to",
      },
    },
  },
};

export const ServerError: Story = {
  name: "Server error — Interpret request failed",
  args: {
    workbook: DEMO_WORKBOOK,
    regions: [FIRST_REGION],
    activeSheetId: FIRST_REGION.sheetId,
    selectedRegionId: FIRST_REGION.id,
    serverError: {
      message:
        "The interpreter service is temporarily unavailable. Please retry in a moment.",
      code: "INTERPRETER_UNAVAILABLE",
    },
  },
};
