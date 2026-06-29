import { describe, it, expect } from "@jest/globals";

import { AnalyticsService } from "../../services/analytics.service.js";

// Three well-separated, tight 2-D clusters. Deterministic (no RNG): each
// center gets points at fixed small offsets, then we interleave them so the
// stream sees a mixed order (mini-batch must not depend on grouping).
const CENTERS = [
  [0, 0],
  [10, 10],
  [0, 10],
];
const OFFSETS = [
  [0.1, 0.1],
  [-0.1, -0.1],
  [0.1, -0.1],
  [-0.1, 0.1],
  [0.05, -0.05],
  [-0.05, 0.05],
];
const RECORDS: Record<string, unknown>[] = [];
for (let rep = 0; rep < 40; rep++) {
  for (let ci = 0; ci < CENTERS.length; ci++) {
    const off = OFFSETS[(rep + ci) % OFFSETS.length];
    RECORDS.push({ x: CENTERS[ci][0] + off[0], y: CENTERS[ci][1] + off[1] });
  }
}

async function* asStream(records: Record<string, unknown>[], batch: number) {
  for (let i = 0; i < records.length; i += batch) yield records.slice(i, i + batch);
}

// Nearest-centroid distance — for permutation-tolerant matching.
const nearest = (point: number[], set: number[][]) =>
  Math.min(
    ...set.map((c) =>
      Math.sqrt(c.reduce((s, v, i) => s + (v - point[i]) ** 2, 0))
    )
  );

describe("clusterFromStream (#153 mini-batch k-means)", () => {
  const COLS = ["x", "y"];

  it("recovers the true centers within tolerance (matched by nearest)", async () => {
    const { centroids, sizes, count } = await AnalyticsService.clusterFromStream(
      asStream(RECORDS, 7),
      { columns: COLS, k: 3 }
    );
    expect(centroids).toHaveLength(3);
    expect(count).toBe(RECORDS.length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(RECORDS.length);
    // Every true center has a streamed centroid near it (tight clusters).
    for (const center of CENTERS) {
      expect(nearest(center, centroids)).toBeLessThan(0.5);
    }
  });

  it("agrees with the in-memory fit up to permutation", async () => {
    const inMemory = AnalyticsService.cluster({
      records: RECORDS,
      columns: COLS,
      k: 3,
      seed: 42,
    });
    const { centroids } = await AnalyticsService.clusterFromStream(
      asStream(RECORDS, 10),
      { columns: COLS, k: 3 }
    );
    // Each in-memory centroid has a streamed centroid close by.
    for (const cen of inMemory.centroids) {
      expect(nearest(cen, centroids)).toBeLessThan(0.5);
    }
  });

  it("is invariant to batch size", async () => {
    const a = await AnalyticsService.clusterFromStream(asStream(RECORDS, 1), {
      columns: COLS,
      k: 3,
    });
    const b = await AnalyticsService.clusterFromStream(asStream(RECORDS, 50), {
      columns: COLS,
      k: 3,
    });
    expect(a.centroids).toEqual(b.centroids);
    expect(a.sizes).toEqual(b.sizes);
  });

  it("honors standardize (variance-normalized distance) on skewed-scale data", async () => {
    // y is on a 1000× larger scale; without standardize it dominates distance.
    const skewed = RECORDS.map((r) => ({
      x: r.x as number,
      y: (r.y as number) * 1000,
    }));
    const { centroids } = await AnalyticsService.clusterFromStream(
      asStream(skewed, 8),
      { columns: COLS, k: 3, standardize: true }
    );
    expect(centroids).toHaveLength(3);
    for (const center of CENTERS) {
      const scaled = [center[0], center[1] * 1000];
      expect(nearest(scaled, centroids)).toBeLessThan(500); // raw-unit centroids
    }
  });

  it("returns empty for an empty stream", async () => {
    const out = await AnalyticsService.clusterFromStream(asStream([], 5), {
      columns: COLS,
      k: 3,
    });
    expect(out).toEqual({ centroids: [], sizes: [], count: 0 });
  });
});
