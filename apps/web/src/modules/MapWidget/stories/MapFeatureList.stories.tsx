import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { MapFeatureListUI } from "../MapFeatureList.component";

import type { RenderedFeature } from "../utils/rendered-features.util";

const item = (n: number, zoning: string): RenderedFeature => ({
  key: `layer-0::${n}`,
  layerId: "layer-0-fill",
  source: "layer-0",
  featureId: n,
  label: `${n} Main St · zoning: ${zoning}`,
  properties: {},
  lngLat: [0, 0],
});

const ITEMS = [item(12, "R2"), item(14, "R2"), item(20, "C1"), item(31, "M1")];

const meta = {
  title: "Modules/MapWidget/MapFeatureList",
  component: MapFeatureListUI,
  parameters: { layout: "padded" },
  args: {
    items: ITEMS,
    total: ITEMS.length,
    selectedKey: null,
    onSelect: fn(),
  },
} satisfies Meta<typeof MapFeatureListUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InView: Story = {};

/** One feature picked: its details are open on the map. */
export const Selected: Story = { args: { selectedKey: ITEMS[2].key } };

/** More in view than the list holds. */
export const OverCap: Story = { args: { total: 1_250 } };

export const Empty: Story = { args: { items: [], total: 0 } };
