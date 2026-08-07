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

  it("renders the tiles-pending note for a large (handle) result", () => {
    render(
      <MapWidgetUI spec={pointsSpec} rows={[]} mode="light" tilesPending />
    );
    expect(screen.getByTestId("map-widget-tiles-pending")).toBeInTheDocument();
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
