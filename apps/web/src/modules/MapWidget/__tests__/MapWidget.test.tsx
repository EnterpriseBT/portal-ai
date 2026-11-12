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
    // The style's sources and layers as `getStyle`/`getSource` report them
    // (#928); `getStyle` is a spy so a test can see when it serializes.
    styleSources: Record<string, { attribution?: string }> = {};
    styleLayers: {
      id: string;
      source?: string;
      layout?: { visibility?: string };
    }[] = [];
    getStyle = jest.fn(() => ({
      sources: this.styleSources,
      layers: this.styleLayers,
    }));
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
    getSource(id: string) {
      return this.styleSources[id];
    }
    fitBounds() {}
    jumpTo() {}
    // #796: the canvas the widget describes, the features it lists and the
    // feature state it highlights.
    canvas = { style: {}, setAttribute: jest.fn() };
    getCanvas() {
      return this.canvas;
    }
    queryRenderedFeatures = jest.fn((): unknown[] => []);
    // Every layer the widget adds exists unless a test says otherwise.
    getLayer = jest.fn((id: string): unknown => ({ id }));
    setFeatureState = jest.fn();
    removeFeatureState = jest.fn();
    remove() {}
  }
  // maplibre-gl v6 is ESM-only with named exports (the widget uses
  // `import * as maplibregl`), so the mock exposes named exports rather than a
  // default object.
  const popups: MockPopup[] = [];
  class MockPopup {
    lngLat: unknown;
    html: string | null = null;
    text: string | null = null;
    closeHandlers: Handler[] = [];
    element = document.createElement("div");
    constructor() {
      popups.push(this);
    }
    setLngLat(lngLat: unknown) {
      this.lngLat = lngLat;
      return this;
    }
    setHTML(html: string) {
      this.html = html;
      return this;
    }
    setText(text: string) {
      this.text = text;
      return this;
    }
    addTo() {
      return this;
    }
    on(event: string, fn: Handler) {
      if (event === "close") this.closeHandlers.push(fn);
      return this;
    }
    getElement() {
      return this.element;
    }
    remove() {
      this.closeHandlers.forEach((fn) => fn(undefined));
      return this;
    }
  }
  return {
    __esModule: true,
    __instances: instances,
    __popups: popups,
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

const SUMMARY = "Parcels by class; most are residential.";
const { MapWidgetPlaceholderUI } = await import("../MapWidgetGate.component");
const { expectNoAxeViolations, render: renderThemed } =
  await import("../../../__tests__/test-utils");
const { BASEMAP_LOAD_TIMEOUT_MS, emptyBasemapStyle } =
  await import("../utils/map-config.util");
const maplibreMock = (await import("maplibre-gl")) as unknown as {
  __popups: {
    lngLat: unknown;
    html: string | null;
    text: string | null;
    element: HTMLElement;
    remove: () => void;
  }[];
  __instances: {
    canvas: { setAttribute: jest.Mock };
    queryRenderedFeatures: jest.Mock;
    getLayer: jest.Mock;
    setFeatureState: jest.Mock;
    removeFeatureState: jest.Mock;
    options: Record<string, unknown>;
    setStyle: jest.Mock;
    addLayer: jest.Mock;
    styleSources: Record<string, { attribution?: string }>;
    styleLayers: {
      id: string;
      source?: string;
      layout?: { visibility?: string };
    }[];
    getStyle: jest.Mock;
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
    render(
      <MapWidgetUI summary={SUMMARY} spec={pointsSpec} rows={[]} mode="light" />
    );
    expect(screen.getByTestId("map-widget-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("map-widget-canvas")).not.toBeInTheDocument();
  });

  it("renders the error state and no map when error is set", () => {
    render(
      <MapWidgetUI
        summary={SUMMARY}
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
      <MapWidgetUI
        summary={SUMMARY}
        spec={pointsSpec}
        rows={[]}
        mode="light"
        largeUnpersisted
      />
    );
    expect(
      screen.getByTestId("map-widget-large-unpersisted")
    ).toBeInTheDocument();
  });

  it("renders the map canvas and a colorBy legend when features are present", () => {
    render(
      <MapWidgetUI
        summary={SUMMARY}
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
        summary={SUMMARY}
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
    render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={pointsSpec}
        rows={many}
        mode="light"
      />
    );
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
        summary={SUMMARY}
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
        summary={SUMMARY}
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
        summary={SUMMARY}
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
        summary={SUMMARY}
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
        summary={SUMMARY}
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
        summary={SUMMARY}
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
        summary={SUMMARY}
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
    const { rerender } = render(
      <MapWidgetUI summary={SUMMARY} {...tileProps} spec={lineSpec} />
    );
    expect(screen.getByTestId("map-widget-tile-truncated")).toHaveTextContent(
      /most prominent/i
    );
    // Polygon layer → the existing "partial / all features" copy (regression).
    rerender(<MapWidgetUI summary={SUMMARY} {...tileProps} spec={polySpec} />);
    expect(screen.getByTestId("map-widget-tile-truncated")).toHaveTextContent(
      /all features/i
    );
  });

  it("renders the aggregated-overview notice, suppressing the truncated one (#330)", () => {
    render(
      <MapWidgetUI
        summary={SUMMARY}
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
        summary={SUMMARY}
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
    render(
      <MapWidgetUI
        summary={SUMMARY}
        {...tileProps}
        lastUpdatedAt={Date.now() - 60_000}
      />
    );
    expect(screen.getByTestId("widget-freshness-updated")).toHaveTextContent(
      /updated/i
    );
  });

  it("omits the freshness cue when lastUpdatedAt is absent", () => {
    render(<MapWidgetUI summary={SUMMARY} {...tileProps} />);
    expect(screen.queryByTestId("widget-freshness-updated")).toBeNull();
  });

  it("shows a tile-rendering cue while tilesLoading (#352)", () => {
    render(<MapWidgetUI summary={SUMMARY} {...tileProps} tilesLoading />);
    expect(screen.getByTestId("map-widget-tiles-loading")).toHaveTextContent(
      /rendering/i
    );
  });

  it("omits the tile-rendering cue when not loading", () => {
    render(<MapWidgetUI summary={SUMMARY} {...tileProps} />);
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
        summary={SUMMARY}
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
        summary={SUMMARY}
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
        summary={SUMMARY}
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
        summary={SUMMARY}
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
        summary={SUMMARY}
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
        summary={SUMMARY}
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
        summary={SUMMARY}
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
        summary={SUMMARY}
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

  it("shows the notice when the basemap's tiles fail after its style loads (XYZ)", () => {
    render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={pointsSpec}
        rows={rows}
        mode="light"
        installBasemap={{
          ...CUSTOM,
          styleUrl: "https://tiles.internal/{z}/{x}/{y}.png",
        }}
      />
    );
    act(() => lastMap().emit("style.load"));
    act(() =>
      lastMap().emit("error", { sourceId: "basemap", error: new Error("404") })
    );
    expect(notice()).toBeInTheDocument();
    // The data is fine where it is: no style swap after the style loaded.
    expect(lastMap().setStyle).not.toHaveBeenCalled();
  });

  it("keeps quiet about a basemap tile error once a basemap tile has loaded", () => {
    render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={pointsSpec}
        rows={rows}
        mode="light"
        installBasemap={CUSTOM}
      />
    );
    act(() => lastMap().emit("style.load"));
    act(() =>
      lastMap().emit("data", {
        dataType: "source",
        sourceId: "openmaptiles",
        tile: {},
      })
    );
    act(() =>
      lastMap().emit("error", {
        sourceId: "openmaptiles",
        error: new Error("edge tile 404"),
      })
    );
    expect(notice()).toBeNull();
  });

  it("a data-source error after load is no basemap failure, and logs as an error", () => {
    render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={pointsSpec}
        rows={rows}
        mode="light"
        installBasemap={CUSTOM}
      />
    );
    act(() => lastMap().emit("style.load"));
    errorSpy.mockClear();
    act(() =>
      lastMap().emit("error", {
        sourceId: "layer-0",
        error: new Error("bad geojson"),
      })
    );
    expect(notice()).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("`default` (SaaS CARTO) never times out a slow style", () => {
    jest.useFakeTimers();
    render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={pointsSpec}
        rows={rows}
        mode="light"
      />
    );
    act(() => jest.advanceTimersByTime(BASEMAP_LOAD_TIMEOUT_MS * 3));
    expect(lastMap().setStyle).not.toHaveBeenCalled();
    expect(notice()).toBeNull();
  });

  it("`default` still falls back when its style actually errors", () => {
    render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={pointsSpec}
        rows={rows}
        mode="light"
      />
    );
    act(() => lastMap().emit("error", { error: new Error("blocked") }));
    expect(lastMap().setStyle).toHaveBeenCalledTimes(1);
    expect(notice()).toBeInTheDocument();
  });
});

describe("MapWidgetUI — safe attribution (#928)", () => {
  const rows = [{ lat: 1, lng: 2 }];
  const lastMap = () =>
    maplibreMock.__instances[maplibreMock.__instances.length - 1];
  const CARTO =
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/about-carto/">CARTO</a>';
  /** Give the mock map a style whose layers draw from these sources. */
  const withSources = (sources: Record<string, string | undefined>) => {
    const map = lastMap();
    map.styleSources = Object.fromEntries(
      Object.entries(sources).map(([id, attribution]) => [id, { attribution }])
    );
    map.styleLayers = Object.keys(sources).map((id) => ({
      id: `${id}-layer`,
      source: id,
    }));
    map.emit("styledata");
  };

  beforeEach(() => {
    maplibreMock.__instances.length = 0;
  });

  it("turns off MapLibre's HTML attribution control", () => {
    render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={pointsSpec}
        rows={rows}
        mode="light"
      />
    );
    expect(lastMap().options.attributionControl).toBe(false);
  });

  it("renders a hostile source attribution as text only", () => {
    render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={pointsSpec}
        rows={rows}
        mode="light"
      />
    );
    act(() =>
      withSources({
        hostile:
          'HOSTILE<style>body{display:none}</style><form action="https://evil.example"><input type="password"></form><a href="https://evil.example">Sign in</a><a href="https://attacker.carto.com/">CARTO login</a>',
      })
    );
    const box = screen.getByTestId("map-attribution");
    expect(box).toHaveTextContent("HOSTILESign inCARTO login");
    const widget = screen.getByTestId("map-widget");
    expect(widget.querySelector("style, form, input, img")).toBeNull();
    expect(widget.querySelector("[data-testid=map-attribution] a")).toBeNull();
  });

  it("keeps CARTO's credits as links", () => {
    render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={pointsSpec}
        rows={rows}
        mode="light"
      />
    );
    act(() => withSources({ carto: CARTO }));
    expect(screen.getByRole("link", { name: "CARTO" })).toHaveAttribute(
      "href",
      "https://carto.com/about-carto/"
    );
    expect(screen.getByTestId("map-attribution")).toHaveTextContent(
      "© OpenStreetMap contributors © CARTO"
    );
  });

  it("credits only sources a visible layer draws from", () => {
    render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={pointsSpec}
        rows={rows}
        mode="light"
      />
    );
    act(() => {
      const map = lastMap();
      map.styleSources = {
        used: { attribution: "© Used" },
        unused: { attribution: "© Unused" },
        hidden: { attribution: "© Hidden" },
      };
      map.styleLayers = [
        { id: "a", source: "used" },
        { id: "b", source: "hidden", layout: { visibility: "none" } },
        { id: "bg" },
      ];
      map.emit("styledata");
    });
    expect(screen.getByTestId("map-attribution")).toHaveTextContent(/^© Used$/);
  });

  it("keeps an operator's https credit links under a custom basemap", () => {
    render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={pointsSpec}
        rows={rows}
        mode="light"
        installBasemap={{
          mode: "custom",
          styleUrl: "https://tiles.corp.example/style.json",
          styleUrlDark: null,
          attribution: "",
        }}
      />
    );
    act(() =>
      withSources({
        maptiler:
          '<a href="https://www.maptiler.com/copyright/">© MapTiler</a>',
      })
    );
    expect(screen.getByRole("link", { name: "© MapTiler" })).toHaveAttribute(
      "href",
      "https://www.maptiler.com/copyright/"
    );
  });

  it("re-reads attribution on source metadata, not on every tile", () => {
    render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={pointsSpec}
        rows={rows}
        mode="light"
      />
    );
    const map = lastMap();
    map.getStyle.mockClear();
    act(() => {
      for (let i = 0; i < 20; i++) map.emit("sourcedata", { tile: {} });
    });
    expect(map.getStyle).not.toHaveBeenCalled();
    act(() => {
      map.styleSources = { carto: { attribution: CARTO } };
      map.styleLayers = [{ id: "c", source: "carto" }];
      map.emit("sourcedata", { sourceDataType: "metadata" });
    });
    expect(map.getStyle).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("map-attribution")).toHaveTextContent("CARTO");
  });

  it("shows no attribution when no source credits anyone", () => {
    render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={pointsSpec}
        rows={rows}
        mode="light"
      />
    );
    act(() => withSources({ "layer-0": undefined }));
    expect(screen.queryByTestId("map-attribution")).toBeNull();
  });
});

// #796: the map is a figure named by its title and described by its summary.
describe("MapWidget as a figure (#796)", () => {
  it("is named by its title, or 'Map' without one", () => {
    const { rerender } = render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={pointsSpec}
        rows={[]}
        mode="light"
        title="Parcels"
      />
    );
    expect(screen.getByRole("figure", { name: "Parcels" })).toBeInTheDocument();
    rerender(
      <MapWidgetUI summary={SUMMARY} spec={pointsSpec} rows={[]} mode="light" />
    );
    expect(screen.getByRole("figure", { name: "Map" })).toBeInTheDocument();
  });

  it("is described by its visible summary", () => {
    render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={polySpec}
        rows={[poly("a")]}
        mode="light"
        title="Parcels"
      />
    );
    expect(
      screen.getByRole("figure", { name: "Parcels" })
    ).toHaveAccessibleDescription(SUMMARY);
  });

  it("keeps an offscreen placeholder a named, described figure", () => {
    render(
      <MapWidgetPlaceholderUI height={400} title="Parcels" summary={SUMMARY} />
    );
    expect(
      screen.getByRole("figure", { name: "Parcels" })
    ).toHaveAccessibleDescription(SUMMARY);
  });

  it("has no axe violations", async () => {
    const { container } = renderThemed(
      <MapWidgetUI
        summary={SUMMARY}
        spec={polySpec}
        rows={[poly("a")]}
        mode="light"
        title="Parcels"
      />
    );
    await expectNoAxeViolations(container);
  });
});

// #796: the map's data, one disclosure away.
describe("MapWidget data alternative (#796)", () => {
  it("toggles the data the UI is given", () => {
    render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={polySpec}
        rows={[poly("a")]}
        mode="light"
        title="Parcels"
        data={<p>the rows</p>}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Show data" }));
    expect(
      screen.getByRole("region", { name: "Data for Parcels" })
    ).toHaveTextContent("the rows");
  });

  it("still offers the data when the map errors", () => {
    render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={pointsSpec}
        rows={[]}
        mode="light"
        error="boom"
        status="error"
        data={<p>the rows</p>}
      />
    );
    expect(
      screen.getByRole("button", { name: "Show data" })
    ).toBeInTheDocument();
  });

  it("has no axe violations with the data open", async () => {
    const { container } = renderThemed(
      <MapWidgetUI
        summary={SUMMARY}
        spec={polySpec}
        rows={[poly("a")]}
        mode="light"
        title="Parcels"
        data={<p>the rows</p>}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Show data" }));
    await expectNoAxeViolations(container);
  });
});

// #796: a keyboard user can read how the map's keys work, walk the features in
// view, and open any of them.
describe("MapWidget keyboard inspection (#796)", () => {
  const lastMap = () =>
    maplibreMock.__instances[maplibreMock.__instances.length - 1];
  const parcel = (id: number, klass: string) => ({
    id,
    layer: { id: "layer-0-fill" },
    source: "layer-0",
    properties: { name: `Parcel ${id}`, klass },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 0],
        ],
      ],
    },
  });
  const renderMap = () =>
    render(
      <MapWidgetUI
        summary={SUMMARY}
        spec={polySpec}
        rows={[poly("a"), poly("b")]}
        mode="light"
        title="Parcels"
      />
    );
  const showFeatures = (features: unknown[]) => {
    lastMap().queryRenderedFeatures.mockReturnValue(features);
    act(() => lastMap().emit("style.load"));
    act(() => lastMap().emit("idle"));
  };

  beforeEach(() => {
    maplibreMock.__instances.length = 0;
    maplibreMock.__popups.length = 0;
  });
  afterEach(() => jest.useRealTimers());

  it("names the canvas after the map and describes its keys", () => {
    renderMap();
    expect(lastMap().options.locale).toEqual({ "Map.Title": "Map: Parcels" });
    const hint = screen.getByText(
      "Arrow keys pan, + and − zoom, when the map has focus."
    );
    expect(lastMap().canvas.setAttribute).toHaveBeenCalledWith(
      "aria-describedby",
      hint.id
    );
  });

  it("lists the features in view once the map settles, with the colour's value", () => {
    renderMap();
    showFeatures([parcel(1, "a"), parcel(2, "b")]);
    expect(
      screen.getByRole("heading", { name: "Features in view (2)" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "name: Parcel 2, klass: b" })
    ).toBeInTheDocument();
  });

  it("opens a selected feature's details and highlights it", () => {
    renderMap();
    showFeatures([parcel(1, "a"), parcel(2, "b")]);
    fireEvent.click(screen.getByRole("button", { name: /Parcel 1/ }));
    expect(lastMap().setFeatureState).toHaveBeenCalledWith(
      { source: "layer-0", id: 1 },
      { selected: true }
    );
    expect(maplibreMock.__popups.at(-1)?.lngLat).toEqual([1, 1]);
    expect(screen.getByRole("button", { name: /Parcel 1/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    fireEvent.click(screen.getByRole("button", { name: /Parcel 2/ }));
    expect(lastMap().setFeatureState).toHaveBeenLastCalledWith(
      { source: "layer-0", id: 2 },
      { selected: true }
    );
    expect(lastMap().removeFeatureState).toHaveBeenCalledWith(
      { source: "layer-0", id: 1 },
      "selected"
    );
  });

  it("closes the details on Escape and returns focus to the list", () => {
    renderMap();
    showFeatures([parcel(1, "a")]);
    const button = screen.getByRole("button", { name: /Parcel 1/ });
    fireEvent.click(button);
    const popup = maplibreMock.__popups.at(-1)!;
    fireEvent.keyDown(popup.element, { key: "Escape" });
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("announces the count after the view moves", () => {
    jest.useFakeTimers();
    renderMap();
    showFeatures([parcel(1, "a")]);
    act(() => lastMap().emit("moveend"));
    lastMap().queryRenderedFeatures.mockReturnValue([
      parcel(1, "a"),
      parcel(2, "b"),
    ]);
    act(() => lastMap().emit("idle"));
    expect(screen.queryByText("2 features in view")).not.toBeInTheDocument();
    act(() => jest.advanceTimersByTime(500));
    expect(screen.getByRole("status")).toHaveTextContent("2 features in view");
  });

  // #796 review: only a keyboard close hands focus back to the list.
  it("leaves focus alone when the details close by a click elsewhere", () => {
    renderMap();
    showFeatures([parcel(1, "a")]);
    const button = screen.getByRole("button", { name: /Parcel 1/ });
    fireEvent.click(button);
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    act(() => maplibreMock.__popups.at(-1)!.remove()); // closeOnClick
    expect(elsewhere).toHaveFocus();
    expect(button).toHaveAttribute("aria-pressed", "false");
    elsewhere.remove();
  });

  it("returns focus to the list from the details' own close button", () => {
    renderMap();
    showFeatures([parcel(1, "a")]);
    const button = screen.getByRole("button", { name: /Parcel 1/ });
    fireEvent.click(button);
    const popup = maplibreMock.__popups.at(-1)!;
    const close = document.createElement("button");
    popup.element.appendChild(close);
    document.body.appendChild(popup.element);
    close.focus();
    act(() => popup.remove());
    expect(button).toHaveFocus();
    popup.element.remove();
  });

  // #796 review: the map's own first fit isn't a move the user made.
  it("doesn't announce the count when the map first fits its data", () => {
    jest.useFakeTimers();
    renderMap();
    lastMap().queryRenderedFeatures.mockReturnValue([parcel(1, "a")]);
    act(() => lastMap().emit("style.load"));
    act(() => lastMap().emit("moveend")); // fitBounds on load
    act(() => lastMap().emit("idle"));
    act(() => jest.advanceTimersByTime(500));
    expect(screen.getByRole("status")).not.toHaveTextContent(/in view/);
  });

  // #796 review: a layer MapLibre refused can't be queried.
  it("queries only the layers the map actually has", () => {
    renderMap();
    lastMap().getLayer.mockImplementation(((id: string) =>
      id.endsWith("-outline") ? undefined : { id }) as never);
    showFeatures([parcel(1, "a")]);
    const [{ layers }] = lastMap().queryRenderedFeatures.mock.calls.at(-1) as [
      { layers: string[] },
    ];
    expect(layers.length).toBeGreaterThan(0);
    expect(layers.some((id) => id.endsWith("-outline"))).toBe(false);
  });

  it("has no axe violations with the list showing", async () => {
    const { container } = renderThemed(
      <MapWidgetUI
        summary={SUMMARY}
        spec={polySpec}
        rows={[poly("a")]}
        mode="light"
        title="Parcels"
      />
    );
    showFeatures([parcel(1, "a")]);
    await expectNoAxeViolations(container);
  });
});
