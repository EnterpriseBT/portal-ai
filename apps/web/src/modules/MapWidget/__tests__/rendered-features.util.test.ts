import { collectRenderedFeatures } from "../utils/rendered-features.util";

import type { QueriedFeature } from "../utils/rendered-features.util";

// #796: the features in view, as a list a keyboard user can walk.

const point = (
  props: Record<string, unknown>,
  over: Partial<QueriedFeature> = {}
): QueriedFeature => ({
  id: undefined,
  layer: { id: "layer-0-circle" },
  source: "layer-0",
  properties: props,
  geometry: { type: "Point", coordinates: [10, 20] },
  ...over,
});

describe("collectRenderedFeatures", () => {
  it("dedupes a feature drawn by two layers or split across tiles", () => {
    const poly = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 4],
          [0, 0],
        ],
      ],
    };
    const { items, total } = collectRenderedFeatures(
      [
        point(
          { name: "A" },
          { id: 1, layer: { id: "layer-0-fill" }, geometry: poly }
        ),
        point(
          { name: "A" },
          { id: 1, layer: { id: "layer-0-outline" }, geometry: poly }
        ),
        point(
          { name: "A" },
          { id: 1, layer: { id: "layer-0-fill" }, geometry: poly }
        ),
        point({ name: "B" }, { id: 2 }),
      ],
      { cap: 200 }
    );
    expect(total).toBe(2);
    expect(items.map((i) => i.label)).toEqual(["name: A", "name: B"]);
  });

  it("dedupes id-less features by their properties", () => {
    const { total } = collectRenderedFeatures(
      [point({ name: "A" }), point({ name: "A" }), point({ name: "B" })],
      { cap: 200 }
    );
    expect(total).toBe(2);
  });

  it("caps the list and reports the full total", () => {
    const features = Array.from({ length: 250 }, (_, i) =>
      point({ n: i }, { id: i })
    );
    const { items, total } = collectRenderedFeatures(features, { cap: 200 });
    expect(items).toHaveLength(200);
    expect(total).toBe(250);
  });

  it("labels from the popup template as plain text", () => {
    const { items } = collectRenderedFeatures(
      [point({ address: "12 Main St", klass: "R2" })],
      { cap: 200, template: "<b>{{address}}</b> — {{klass}}" }
    );
    expect(items[0].label).toBe("12 Main St — R2");
  });

  // #796 adversarial F2: a hostile template left its script's body behind.
  it("drops script and style contents along with their tags", () => {
    const { items } = collectRenderedFeatures([point({ name: "Seattle" })], {
      cap: 200,
      template: "<script>alert(1)</script><style>b{}</style>{{name}}",
    });
    expect(items[0].label).toBe("Seattle");
  });

  it("falls back to the first three plain properties", () => {
    const { items } = collectRenderedFeatures(
      [
        point({
          geom: { type: "Point" },
          _internal: 1,
          a: 1,
          b: "two",
          c: true,
          d: 4,
        }),
      ],
      { cap: 200 }
    );
    expect(items[0].label).toBe("a: 1, b: two, c: true");
  });

  it("adds what the layer's colour encodes", () => {
    const { items } = collectRenderedFeatures(
      [point({ parcel: 12, zoning: "R2" })],
      {
        cap: 200,
        template: "Parcel {{parcel}}",
        colorByForLayer: { "layer-0-circle": "zoning" },
      }
    );
    expect(items[0].label).toBe("Parcel 12 · zoning: R2");
  });

  // #796 smoke: "Segment: enterprise · segment: enterprise" and
  // "Lifetime Revenue: $1594810.69 · lifetime_revenue: 1594810.69".
  it.each([
    [
      "Segment: {{segment}}",
      { segment: "enterprise" },
      "segment",
      "Segment: enterprise",
    ],
    [
      "Lifetime Revenue: ${{lifetime_revenue}}",
      { lifetime_revenue: 1594810.69 },
      "lifetime_revenue",
      "Lifetime Revenue: $1594810.69",
    ],
  ])(
    "doesn't repeat a colour value the label already shows (%s)",
    (template, props, column, label) => {
      const { items } = collectRenderedFeatures([point(props)], {
        cap: 200,
        template,
        colorByForLayer: { "layer-0-circle": column },
      });
      expect(items[0].label).toBe(label);
    }
  );

  it("skips aggregate bins", () => {
    const { total } = collectRenderedFeatures(
      [point({ _agg: 1, _count: 40 }), point({ name: "A" })],
      { cap: 200 }
    );
    expect(total).toBe(1);
  });

  it("places each item at its point, or its bounding-box centre", () => {
    const { items } = collectRenderedFeatures(
      [
        point({ n: 1 }, { id: 1 }),
        point(
          { n: 2 },
          {
            id: 2,
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                [4, 2],
              ],
            },
          }
        ),
        point(
          { n: 3 },
          {
            id: 3,
            geometry: {
              type: "MultiPolygon",
              coordinates: [
                [
                  [
                    [-2, -2],
                    [2, -2],
                    [2, 6],
                    [-2, -2],
                  ],
                ],
              ],
            },
          }
        ),
      ],
      { cap: 200 }
    );
    expect(items.map((i) => i.lngLat)).toEqual([
      [10, 20],
      [2, 1],
      [0, 2],
    ]);
  });

  it("keeps what feature state needs to highlight the item", () => {
    const { items } = collectRenderedFeatures(
      [point({ n: 1 }, { id: 7, source: "ctx", sourceLayer: "rows" })],
      { cap: 200 }
    );
    expect(items[0]).toMatchObject({
      source: "ctx",
      sourceLayer: "rows",
      featureId: 7,
      layerId: "layer-0-circle",
    });
  });
});
