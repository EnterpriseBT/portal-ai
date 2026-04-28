import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import type { SelectOption } from "@portalai/core/ui";

import { ReviewStepUI } from "../ReviewStep.component";
import {
  PROPOSED_REGIONS,
  BLOCKER_REGIONS,
  DRIFT_REGIONS,
} from "./utils/region-editor-fixtures.util";

const columnDefinitionSearch = {
  onSearch: async (_q: string) => [] as SelectOption[],
  onSearchPending: false,
  onSearchError: null,
  getById: async (_id: string) => null,
  getByIdPending: false,
  getByIdError: null,
  labelMap: {},
};

const meta = {
  title: "Modules/RegionEditor/ReviewStepUI",
  component: ReviewStepUI,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 960, minHeight: 560 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReviewStepUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MixedConfidence: Story = {
  name: "Mixed confidence (green/yellow/red)",
  args: {
    regions: PROPOSED_REGIONS,
    overallConfidence: 0.78,
    onJumpToRegion: fn(),
    onEditBinding: fn(),
    onCommit: fn(),
    onBack: fn(),
  },
};

export const BlockerPreventsCommit: Story = {
  name: "Blocker prevents commit",
  args: {
    regions: BLOCKER_REGIONS,
    overallConfidence: 0.42,
    onJumpToRegion: fn(),
    onEditBinding: fn(),
    onCommit: fn(),
    onBack: fn(),
  },
};

export const DriftReview: Story = {
  name: "Drift review — blocker on identity change",
  args: {
    regions: DRIFT_REGIONS,
    overallConfidence: 0.61,
    onJumpToRegion: fn(),
    onEditBinding: fn(),
    onCommit: fn(),
    onBack: fn(),
  },
};

export const Committing: Story = {
  name: "Committing",
  args: {
    regions: PROPOSED_REGIONS,
    overallConfidence: 0.78,
    onJumpToRegion: fn(),
    onEditBinding: fn(),
    onCommit: fn(),
    onBack: fn(),
    isCommitting: true,
  },
};

export const WithBindingEditor: Story = {
  name: "With binding editor (chip click opens the popover)",
  args: {
    regions: PROPOSED_REGIONS,
    overallConfidence: 0.78,
    onJumpToRegion: fn(),
    onEditBinding: fn(),
    // When the popover deps are supplied, chip click opens the editor instead
    // of firing onEditBinding. See BindingEditorPopover stories for isolated
    // coverage of the popover contents themselves.
    onUpdateBinding: fn(),
    onToggleBindingExcluded: fn(),
    columnDefinitionSearch,
    resolveColumnDefinitionType: () => "string" as const,
    onCommit: fn(),
    onBack: fn(),
  },
};
