import type { Meta, StoryObj } from "@storybook/react";

import { MapWidgetUI } from "../MapWidget.component";

import type { MapSpec } from "@portalai/core/contracts";

/**
 * Storybook is the real-browser surface where MapLibre actually paints (jsdom
 * mocks it). These stories render `MapWidgetUI` directly with inline data, so
 * they need no SDK, router, or provider — per the Component File Policy.
 */

const meta: Meta<typeof MapWidgetUI> = {
  title: "Modules/MapWidget",
  component: MapWidgetUI,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof MapWidgetUI>;

const spec = (layers: unknown[], popup?: { template: string }): MapSpec =>
  ({
    basemap: "carto-light",
    initialView: "fit",
    layers,
    popup,
  }) as unknown as MapSpec;

// A handful of SLC-area parcels as GeoJSON polygons + a class for colouring.
const parcel = (
  lng: number,
  lat: number,
  prop_class: string,
  address: string
) => ({
  geom: {
    type: "Polygon",
    coordinates: [
      [
        [lng, lat],
        [lng + 0.01, lat],
        [lng + 0.01, lat + 0.008],
        [lng, lat + 0.008],
        [lng, lat],
      ],
    ],
  },
  prop_class,
  address,
});

const PARCELS = [
  parcel(-111.9, 40.76, "vacant", "100 S Main"),
  parcel(-111.88, 40.77, "improved", "200 E 200 S"),
  parcel(-111.87, 40.75, "vacant", "300 S State"),
  parcel(-111.91, 40.74, "improved", "400 W 400 S"),
];

const POINTS = [
  { lat: 40.76, lng: -111.9, name: "A" },
  { lat: 40.77, lng: -111.88, name: "B" },
  { lat: 40.75, lng: -111.87, name: "C" },
];

export const PolygonsColoredByClass: Story = {
  args: {
    mode: "light",
    title: "Parcels — coloured by zoning",
    spec: spec(
      [
        {
          kind: "polygons",
          source: { geometryColumn: "geom" },
          style: { colorBy: { column: "prop_class" }, opacity: 0.6 },
        },
      ],
      { template: "{{address}} — {{prop_class}}" }
    ),
    rows: PARCELS,
  },
};

export const HighlightVacantByExpression: Story = {
  args: {
    mode: "light",
    title: "Highlight the vacant ones",
    spec: spec([
      {
        kind: "polygons",
        source: { geometryColumn: "geom" },
        style: {
          color: [
            "case",
            ["==", ["get", "prop_class"], "vacant"],
            "#ff8a00",
            "#cfd8dc",
          ],
          outlineColor: [
            "case",
            ["==", ["get", "prop_class"], "vacant"],
            "#c25e00",
            "#90a4ae",
          ],
        },
      },
    ]),
    rows: PARCELS,
  },
};

export const Points: Story = {
  args: {
    mode: "light",
    spec: spec([
      { kind: "points", source: { latColumn: "lat", lngColumn: "lng" } },
    ]),
    rows: POINTS,
  },
};

export const Dark: Story = {
  args: { ...PolygonsColoredByClass.args, mode: "dark" },
};

export const Empty: Story = {
  args: {
    mode: "light",
    spec: spec([
      { kind: "points", source: { latColumn: "lat", lngColumn: "lng" } },
    ]),
    rows: [],
  },
};

export const ErrorState: Story = {
  args: {
    mode: "light",
    spec: spec([
      { kind: "points", source: { latColumn: "lat", lngColumn: "lng" } },
    ]),
    rows: [],
    error: "The map failed to render.",
    status: "error",
  },
};

export const LargeResultTilesPending: Story = {
  args: {
    mode: "light",
    title: "All parcels (large result)",
    spec: spec([{ kind: "polygons", source: { geometryColumn: "geom" } }]),
    rows: [],
    tilesPending: true,
  },
};
