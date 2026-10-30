import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { act, render, screen, fireEvent } from "@testing-library/react";

import type { MapSpec } from "@portalai/core/contracts";

type Handler = (payload?: unknown) => void;

// maplibre-gl is mocked at the module boundary — the UI's mount effect runs
// against the mock (no event fires unless a test `emit`s it, so no
// source/layer/WebGL code executes by default), and the test asserts the
// chrome the UI renders from props. Each map records its constructor options,
// its handlers and its setStyle calls (#910) so a test can drive the
// basemap-fallback lifecycle.
jest.unstable_mockModule("maplibre-gl", () => {
  const instances: MockMap[] = [];
  class MockMap {
    options: Record<string, unknown>;
    handlers: { event: string; once: boolean; fn: Handler }[] = [];
    setStyle = jest.fn();
    addLayer = jest.fn();
    constructor(options: Record<string, unknown>) {
      this.options = options;
      instances.push(this);
    }
    on(event: string, layerOrFn: string | Handler, fn?: Handler) {
      // Layer-scoped handlers (`on("click", layerId, fn)`) are recorded as
      // `event:layerId` so they never fire on a map-level emit.
      if (typeof layerOrFn === "function") {
        this.handlers.push({ event, once: false, fn: layerOrFn });
      } else if (fn) {
        this.handlers.push({ event: `${event}:${layerOrFn}`, once: false, fn });
      }
      return this;
    }
    once(event: string, fn: Handler) {
      this.handlers.push({ event, once: true, fn });
      return this;
    }
    emit(event: string, payload?: unknown) {
      const matching = this.handlers.filter((h) => h.event === event);
      this.handlers = this.handlers.filter(
        (h) => !(h.event === event && h.once)
      );
      matching.forEach((h) => h.fn(payload));
    }
    addControl() {
      return this;
    }
    addSource() {}
    fitBounds() {}
    jumpTo() {}
    getCanvas() {
      return { style: {} };
    }
    remove() {}
  }
  // maplibre-gl v6 is ESM-only with named exports (the widget uses
  // `import * as maplibregl`), so the mock exposes named exports rather than a
  // default object.
  class MockPopup {
    setLngLat() {
      return this;
    }
    setHTML() {
      return this;
    }
    addTo() {
      return this;
    }
  }
  return {
    __esModule: true,
    __instances: instances,
    Map: MockMap,
    addProtocol: () => {},
    removeProtocol: () => {},
    // #548: MapWidget calls setWorkerUrl at module scope to point maplibre-gl
    // v6's ESM tile worker at the Vite-emitted asset (the worker isn't
    // statically detectable, so Vite doesn't emit it without the explicit
    // `?worker&url` import). No-op under jest.
    setWorkerUrl: () => {},
    NavigationControl: class {},
    Popup: MockPopup,
  };
});

const { MapWidgetUI } = await import("../MapWidget.component");
const { BASEMAP_LOAD_TIMEOUT_MS, emptyBasemapStyle } =
  await import("../utils/map-config.util");
const maplibreMock = (await import("maplibre-gl")) as unknown as {
  __instances: {
    options: Record<string, unknown>;
    setStyle: jest.Mock;
    addLayer: jest.Mock;
    emit: (event: string, payload?: unknown) => void;
  }[];
};
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

  it("renders a gradient legend bar with min/max labels for an interpolate scale (#336)", () => {
    const gradientSpec = {
      basemap: "carto-light",
      initialView: "fit",
      layers: [
        {
          kind: "polygons",
          source: { geometryColumn: "geom" },
          style: {
            colorBy: {
              column: "value",
              scale: "interpolate",
              stops: [
                [0, "#000000"],
                [500, "#ffffff"],
              ],
            },
          },
        },
      ],
    } as unknown as MapSpec;
    render(
      <MapWidgetUI
        spec={gradientSpec}
        rows={[{ ...poly("a"), value: 250 }]}
        mode="light"
      />
    );
    const bar = screen.getByTestId("map-widget-legend-gradient");
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveTextContent("0");
    expect(bar).toHaveTextContent("500");
    // The swatch legend is not used for a gradient layer.
    expect(screen.queryByTestId("map-widget-legend")).not.toBeInTheDocument();
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
          failed: false,
          busy: false,
          rateLimited: false,
          unavailable: false,
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
          failed: false,
          busy: false,
          rateLimited: false,
          unavailable: false,
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
          failed: false,
          busy: false,
          rateLimited: false,
          unavailable: false,
        }}
      />
    );
    expect(screen.getByTestId("map-widget-tile-timeout")).toBeInTheDocument();

    // #698: a saturated tile gate reads as busy, not as a failure.
    rerender(
      <MapWidgetUI
        {...tileProps}
        tileStatus={{
          simplified: false,
          truncated: false,
          timedOut: false,
          aggregated: false,
          failed: false,
          busy: true,
          rateLimited: false,
          unavailable: false,
        }}
      />
    );
    expect(screen.getByTestId("map-widget-tile-busy")).toBeInTheDocument();
    expect(screen.queryByTestId("map-widget-tile-failed")).toBeNull();

    rerender(
      <MapWidgetUI
        {...tileProps}
        tileStatus={{
          simplified: false,
          truncated: false,
          timedOut: false,
          aggregated: false,
          failed: true,
          busy: false,
          rateLimited: false,
          unavailable: false,
        }}
      />
    );
    expect(screen.getByTestId("map-widget-tile-failed")).toBeInTheDocument();

    // #640: a pin whose definer lost access — explained, not a failure.
    rerender(
      <MapWidgetUI
        {...tileProps}
        tileStatus={{
          simplified: false,
          truncated: false,
          timedOut: false,
          aggregated: false,
          failed: false,
          busy: false,
          rateLimited: false,
          unavailable: true,
        }}
      />
    );
    expect(screen.getByTestId("map-widget-tile-unavailable")).toHaveTextContent(
      "This pin's data isn't available."
    );
    expect(screen.queryByTestId("map-widget-tile-failed")).toBeNull();

    // #705: over the per-user tile limit is a timed pause, never a failure.
    rerender(
      <MapWidgetUI
        {...tileProps}
        tileStatus={{
          simplified: false,
          truncated: false,
          timedOut: false,
          aggregated: false,
          failed: false,
          busy: false,
          rateLimited: true,
          unavailable: false,
        }}
      />
    );
    expect(
      screen.getByTestId("map-widget-tile-rate-limited")
    ).toHaveTextContent(
      "Loading map tiles too quickly — tiles will load when you pan or zoom."
    );
    expect(screen.queryByTestId("map-widget-tile-failed")).toBeNull();
    expect(screen.queryByTestId("map-widget-tile-busy")).toBeNull();
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
        failed: false,
        busy: false,
        rateLimited: false,
        unavailable: false,
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
          failed: false,
          busy: false,
          rateLimited: false,
          unavailable: false,
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

describe("MapWidgetUI — status cues (#348, #352)", () => {
  const tileProps = {
    spec: pointsSpec,
    rows: [],
    mode: "light" as const,
    tileTemplate: "/api/portal-map/tiles/pin/p1/{z}/{x}/{y}.mvt",
    getTileToken: async () => "tok",
  };

  it("shows an 'Updated …' freshness cue when lastUpdatedAt is set (#348)", () => {
    render(<MapWidgetUI {...tileProps} lastUpdatedAt={Date.now() - 60_000} />);
    expect(screen.getByTestId("widget-freshness-updated")).toHaveTextContent(
      /updated/i
    );
  });

  it("omits the freshness cue when lastUpdatedAt is absent", () => {
    render(<MapWidgetUI {...tileProps} />);
    expect(screen.queryByTestId("widget-freshness-updated")).toBeNull();
  });

  it("shows a tile-rendering cue while tilesLoading (#352)", () => {
    render(<MapWidgetUI {...tileProps} tilesLoading />);
    expect(screen.getByTestId("map-widget-tiles-loading")).toHaveTextContent(
      /rendering/i
    );
  });

  it("omits the tile-rendering cue when not loading", () => {
    render(<MapWidgetUI {...tileProps} />);
    expect(screen.queryByTestId("map-widget-tiles-loading")).toBeNull();
  });
});

describe("MapWidgetUI — install basemap + fallback (#910)", () => {
  const rows = [{ lat: 1, lng: 2 }];
  const specWithUrl = {
    ...pointsSpec,
    basemap: { url: "https://elsewhere.example/style.json" },
  } as unknown as MapSpec;
  const CUSTOM = {
    mode: "custom",
    styleUrl: "https://tiles.internal/light.json",
    styleUrlDark: null,
    attribution: "",
  } as const;
  const lastMap = () =>
    maplibreMock.__instances[maplibreMock.__instances.length - 1];
  const notice = () => screen.queryByText("Basemap unavailable");

  let errorSpy: ReturnType<typeof jest.spyOn>;
  beforeEach(() => {
    maplibreMock.__instances.length = 0;
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("constructs the map on the install's basemap, not the spec's", () => {
    const { unmount } = render(
      <MapWidgetUI
        spec={specWithUrl}
        rows={rows}
        mode="light"
        installBasemap={{ mode: "none" }}
      />
    );
    expect(lastMap().options.style).toEqual(emptyBasemapStyle("light"));
    unmount();

    render(
      <MapWidgetUI
        spec={specWithUrl}
        rows={rows}
        mode="light"
        installBasemap={CUSTOM}
      />
    );
    expect(lastMap().options.style).toBe("https://tiles.internal/light.json");
  });

  it("an error before the style loads swaps to the empty style and shows the notice", () => {
    render(
      <MapWidgetUI
        spec={pointsSpec}
        rows={rows}
        mode="dark"
        installBasemap={CUSTOM}
      />
    );
    expect(notice()).toBeNull();
    act(() => lastMap().emit("error", { error: new Error("fetch failed") }));
    expect(lastMap().setStyle).toHaveBeenCalledWith(emptyBasemapStyle("dark"), {
      diff: false,
    });
    expect(notice()).toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("attaches the data layers once the fallback style loads", () => {
    render(
      <MapWidgetUI
        spec={pointsSpec}
        rows={rows}
        mode="light"
        installBasemap={CUSTOM}
      />
    );
    act(() => lastMap().emit("error", { error: new Error("blocked") }));
    expect(lastMap().addLayer).not.toHaveBeenCalled();
    act(() => lastMap().emit("style.load"));
    expect(lastMap().addLayer).toHaveBeenCalled();
    const calls = lastMap().addLayer.mock.calls.length;
    act(() => lastMap().emit("style.load"));
    expect(lastMap().addLayer.mock.calls.length).toBe(calls);
  });

  it("falls back when the style hasn't loaded within the timeout", () => {
    jest.useFakeTimers();
    render(
      <MapWidgetUI
        spec={pointsSpec}
        rows={rows}
        mode="light"
        installBasemap={CUSTOM}
      />
    );
    act(() => jest.advanceTimersByTime(BASEMAP_LOAD_TIMEOUT_MS - 1));
    expect(lastMap().setStyle).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(lastMap().setStyle).toHaveBeenCalledTimes(1);
    expect(notice()).toBeInTheDocument();
  });

  it("ignores errors after the style has loaded (tile errors are logged only)", () => {
    jest.useFakeTimers();
    render(
      <MapWidgetUI
        spec={pointsSpec}
        rows={rows}
        mode="light"
        installBasemap={CUSTOM}
      />
    );
    act(() => lastMap().emit("style.load"));
    act(() => lastMap().emit("error", { error: new Error("tile 404") }));
    act(() => jest.advanceTimersByTime(BASEMAP_LOAD_TIMEOUT_MS));
    expect(lastMap().setStyle).not.toHaveBeenCalled();
    expect(notice()).toBeNull();
  });

  it("shows no notice under `none`, which is a choice rather than a failure", () => {
    render(
      <MapWidgetUI
        spec={pointsSpec}
        rows={rows}
        mode="light"
        installBasemap={{ mode: "none" }}
      />
    );
    act(() => lastMap().emit("error", { error: new Error("anything") }));
    expect(lastMap().setStyle).not.toHaveBeenCalled();
    expect(notice()).toBeNull();
  });

  it("clears the timeout on unmount", () => {
    jest.useFakeTimers();
    const { unmount } = render(
      <MapWidgetUI
        spec={pointsSpec}
        rows={rows}
        mode="light"
        installBasemap={CUSTOM}
      />
    );
    const map = lastMap();
    unmount();
    act(() => jest.advanceTimersByTime(BASEMAP_LOAD_TIMEOUT_MS));
    expect(map.setStyle).not.toHaveBeenCalled();
  });
});
