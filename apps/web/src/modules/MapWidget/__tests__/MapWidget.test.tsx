import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";

import type { MapSpec } from "@portalai/core/contracts";

// maplibre-gl is mocked at the module boundary — the UI's mount effect runs
// against the mock (its "load" callback never fires, so no source/layer/WebGL
// code executes), and the test asserts the chrome the UI renders from props.
jest.unstable_mockModule("maplibre-gl", () => {
  class MockMap {
    on() {
      return this;
    }
    addControl() {
      return this;
    }
    addSource() {}
    addLayer() {}
    fitBounds() {}
    getCanvas() {
      return { style: {} };
    }
    remove() {}
  }
  return {
    default: {
      Map: MockMap,
      addProtocol: () => {},
      removeProtocol: () => {},
      NavigationControl: class {},
      Popup: class {
        setLngLat() {
          return this;
        }
        setHTML() {
          return this;
        }
        addTo() {
          return this;
        }
      },
    },
  };
});

const { MapWidgetUI } = await import("../MapWidget.component");
const { registerMapBlockRenderer } = await import("../utils/register.util");
const { hasBlockRenderer } = await import("@portalai/core");

const pointsSpec = {
  basemap: "carto-light",
  initialView: "fit",
  layers: [{ kind: "points", source: { latColumn: "lat", lngColumn: "lng" } }],
} as unknown as MapSpec;

const polySpec = {
  basemap: "carto-light",
  initialView: "fit",
  layers: [
    {
      kind: "polygons",
      source: { geometryColumn: "geom" },
      style: { colorBy: { column: "klass" } },
    },
  ],
} as unknown as MapSpec;

const poly = (klass: string) => ({
  geom: {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  },
  klass,
});

describe("MapWidgetUI", () => {
  it("renders the empty state when no rows are mappable", () => {
    render(<MapWidgetUI spec={pointsSpec} rows={[]} mode="light" />);
    expect(screen.getByTestId("map-widget-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("map-widget-canvas")).not.toBeInTheDocument();
  });

  it("renders the error state and no map when error is set", () => {
    render(
      <MapWidgetUI
        spec={pointsSpec}
        rows={[]}
        mode="light"
        error="boom"
        status="error"
      />
    );
    expect(screen.getByTestId("map-widget-error")).toHaveTextContent("boom");
    expect(screen.queryByTestId("map-widget-canvas")).not.toBeInTheDocument();
  });

  it("explains a large result with no persisted ref (can't tile)", () => {
    render(
      <MapWidgetUI spec={pointsSpec} rows={[]} mode="light" largeUnpersisted />
    );
    expect(
      screen.getByTestId("map-widget-large-unpersisted")
    ).toBeInTheDocument();
  });

  it("renders the map canvas and a colorBy legend when features are present", () => {
    render(
      <MapWidgetUI
        spec={polySpec}
        rows={[poly("vacant"), poly("improved")]}
        mode="light"
      />
    );
    expect(screen.getByTestId("map-widget-canvas")).toBeInTheDocument();
    const legend = screen.getByTestId("map-widget-legend");
    expect(legend).toHaveTextContent("vacant");
    expect(legend).toHaveTextContent("improved");
  });

  it("renders the feature-cap notice when a layer is truncated (row 1)", () => {
    // Exceed the default per-layer cap so featuresForLayer flags truncation.
    const many = Array.from({ length: 10_001 }, (_, i) => ({
      lat: i % 80,
      lng: i % 170,
    }));
    render(<MapWidgetUI spec={pointsSpec} rows={many} mode="light" />);
    expect(screen.getByTestId("map-widget-cap-notice")).toHaveTextContent(
      /first .* of .* features/i
    );
  });

  it("renders a vector-tile map + zoom-simplified / partial / timeout notices (rows 2-4)", () => {
    const tileProps = {
      spec: pointsSpec,
      rows: [],
      mode: "light" as const,
      tileTemplate: "/api/portal-map/tiles/pin/p1/{z}/{x}/{y}.mvt",
      getTileToken: async () => "tok",
    };
    const { rerender } = render(
      <MapWidgetUI
        {...tileProps}
        tileStatus={{
          simplified: true,
          truncated: false,
          timedOut: false,
          aggregated: false,
        }}
      />
    );
    // Tile mode renders the canvas even with no inline rows.
    expect(screen.getByTestId("map-widget-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("map-widget-simplified")).toBeInTheDocument();

    rerender(
      <MapWidgetUI
        {...tileProps}
        tileStatus={{
          simplified: false,
          truncated: true,
          timedOut: false,
          aggregated: false,
        }}
      />
    );
    expect(screen.getByTestId("map-widget-tile-truncated")).toBeInTheDocument();

    rerender(
      <MapWidgetUI
        {...tileProps}
        tileStatus={{
          simplified: false,
          truncated: false,
          timedOut: true,
          aggregated: false,
        }}
      />
    );
    expect(screen.getByTestId("map-widget-tile-timeout")).toBeInTheDocument();
  });

  it("truncated line tile reads as ranked ('most prominent'), not arbitrary (#337)", () => {
    const lineSpec = {
      basemap: "carto-light",
      initialView: "fit",
      layers: [{ kind: "lines", source: { geometryColumn: "geom" } }],
    } as unknown as MapSpec;
    const tileProps = {
      rows: [],
      mode: "light" as const,
      tileTemplate: "/api/portal-map/tiles/pin/p1/{z}/{x}/{y}.mvt",
      getTileToken: async () => "tok",
      tileStatus: {
        simplified: false,
        truncated: true,
        timedOut: false,
        aggregated: false,
      },
    };
    // Line layer → "most prominent" copy.
    const { rerender } = render(<MapWidgetUI {...tileProps} spec={lineSpec} />);
    expect(screen.getByTestId("map-widget-tile-truncated")).toHaveTextContent(
      /most prominent/i
    );
    // Polygon layer → the existing "partial / all features" copy (regression).
    rerender(<MapWidgetUI {...tileProps} spec={polySpec} />);
    expect(screen.getByTestId("map-widget-tile-truncated")).toHaveTextContent(
      /all features/i
    );
  });

  it("renders the aggregated-overview notice, suppressing the truncated one (#330)", () => {
    render(
      <MapWidgetUI
        spec={pointsSpec}
        rows={[]}
        mode="light"
        tileTemplate="/api/portal-map/tiles/pin/p1/{z}/{x}/{y}.mvt"
        getTileToken={async () => "tok"}
        tileStatus={{
          simplified: false,
          truncated: true, // even with truncated set …
          timedOut: false,
          aggregated: true, // … the aggregate notice wins
        }}
      />
    );
    expect(screen.getByTestId("map-widget-aggregated")).toBeInTheDocument();
    expect(screen.queryByTestId("map-widget-tile-truncated")).toBeNull();
  });

  it("renders a title and a working refresh control", () => {
    const onRefresh = jest.fn();
    render(
      <MapWidgetUI
        spec={pointsSpec}
        rows={[{ lat: 1, lng: 2 }]}
        mode="light"
        title="Parcels"
        canRefresh
        onRefresh={onRefresh}
      />
    );
    expect(screen.getByText("Parcels")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /refresh map/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("registerMapBlockRenderer", () => {
  beforeAll(() => registerMapBlockRenderer());
  it("registers a renderer for the geo block type", () => {
    expect(hasBlockRenderer("geo")).toBe(true);
  });
});
