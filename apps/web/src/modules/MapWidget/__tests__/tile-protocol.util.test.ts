import { describe, it, expect, jest } from "@jest/globals";

import {
  fetchTile,
  protocolTileUrl,
  type TileContext,
} from "../utils/tile-protocol.util";
import type { TileStatus } from "../utils/tile-source.util";

const mkRes = (status: number, hdrs: Record<string, string> = {}): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => hdrs[k] ?? null },
    arrayBuffer: async () => new ArrayBuffer(8),
  }) as unknown as Response;

function harness(res: Response) {
  const statuses: TileStatus[] = [];
  const registry = new Map<string, TileContext>();
  registry.set("ctx1", {
    getToken: async () => "tok-123",
    onStatus: (s) => statuses.push(s),
  });
  const fetchMock = jest.fn(
    async () => res
  ) as unknown as typeof globalThis.fetch;
  const deps = { fetch: fetchMock, registry, resolveUrl: (p: string) => p };
  return { statuses, registry, fetchMock, deps };
}

describe("fetchTile", () => {
  it("fetches the real API path with a Bearer token and reports clean status", async () => {
    const { statuses, fetchMock, deps } = harness(mkRes(200));
    const url = protocolTileUrl(
      "ctx1",
      "/api/portal-map/tiles/pin/p1/2/1/1.mvt"
    );
    const out = await fetchTile(url, undefined, deps);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/portal-map/tiles/pin/p1/2/1/1.mvt",
      expect.objectContaining({
        headers: { Authorization: "Bearer tok-123" },
      })
    );
    expect(out.data.byteLength).toBe(8);
    expect(statuses[0]).toMatchObject({ simplified: false, truncated: false });
  });

  it("reports simplified + truncated from tile headers", async () => {
    const { statuses, deps } = harness(
      mkRes(200, {
        "X-Portal-Tile-Simplified": "8",
        "X-Portal-Tile-Truncated": "1",
      })
    );
    await fetchTile(
      protocolTileUrl("ctx1", "/api/portal-map/tiles/pin/p1/5/1/1.mvt"),
      undefined,
      deps
    );
    expect(statuses[0]).toMatchObject({ simplified: true, truncated: true });
  });

  it("reports a timeout and throws on 504 so MapLibre retries, not caches empty (#449)", async () => {
    const { statuses, deps } = harness(mkRes(504));
    await expect(
      fetchTile(
        protocolTileUrl("ctx1", "/api/portal-map/tiles/pin/p1/5/1/1.mvt"),
        undefined,
        deps
      )
    ).rejects.toThrow();
    // The notice is still reported before the throw.
    expect(statuses[0]).toMatchObject({ timedOut: true });
  });

  it("reports failed and throws on a non-timeout error (500) (#449)", async () => {
    const { statuses, deps } = harness(mkRes(500));
    await expect(
      fetchTile(
        protocolTileUrl("ctx1", "/api/portal-map/tiles/pin/p1/5/1/1.mvt"),
        undefined,
        deps
      )
    ).rejects.toThrow();
    expect(statuses[0]).toMatchObject({ failed: true, timedOut: false });
  });

  it("returns empty bytes for an empty (204) tile, without throwing", async () => {
    const { deps } = harness(mkRes(204));
    const out = await fetchTile(
      protocolTileUrl("ctx1", "/api/portal-map/tiles/pin/p1/5/1/1.mvt"),
      undefined,
      deps
    );
    expect(out.data.byteLength).toBe(0);
  });

  it("returns empty bytes for a not-modified (304) tile, without throwing", async () => {
    const { deps } = harness(mkRes(304));
    const out = await fetchTile(
      protocolTileUrl("ctx1", "/api/portal-map/tiles/pin/p1/5/1/1.mvt"),
      undefined,
      deps
    );
    expect(out.data.byteLength).toBe(0);
  });
});

describe("fetchTile — concurrency cap (#350)", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  // A harness whose `fetch` never resolves on its own — the test settles each
  // call by hand, so it can observe how many are in flight at once.
  function deferredHarness() {
    const settlers: Array<(r: Response) => void> = [];
    const registry = new Map<string, TileContext>();
    registry.set("ctx1", { getToken: async () => "tok", onStatus: () => {} });
    const fetchMock = jest.fn(
      () => new Promise<Response>((resolve) => settlers.push(resolve))
    ) as unknown as typeof globalThis.fetch;
    const deps = { fetch: fetchMock, registry, resolveUrl: (p: string) => p };
    return { settlers, fetchMock, deps };
  }
  const fire = (deps: FetchTileDepsLike, i: number, signal?: AbortSignal) =>
    fetchTile(
      protocolTileUrl("ctx1", `/api/portal-map/tiles/pin/p/2/0/${i}.mvt`),
      signal,
      deps as never
    );
  type FetchTileDepsLike = Parameters<typeof fetchTile>[2];

  it("caps concurrent fetches at 6 and drains the queue in order", async () => {
    const { settlers, fetchMock, deps } = deferredHarness();
    const calls = Array.from({ length: 8 }, (_, i) =>
      fire(deps, i).catch(() => {})
    );
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(6); // only 6 in flight
    settlers[0](mkRes(200));
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(7); // a slot freed → 7th starts
    settlers[1](mkRes(200));
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(8); // 8th starts
    settlers.forEach((s) => s(mkRes(200)));
    await Promise.all(calls); // drain → state back to 0
  });

  it("a tile aborted while queued never fetches; a freed slot runs the next", async () => {
    const { settlers, fetchMock, deps } = deferredHarness();
    const active = Array.from({ length: 6 }, (_, i) =>
      fire(deps, i).catch(() => {})
    );
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(6);

    const ac = new AbortController();
    const queued = fire(deps, 6, ac.signal); // queued (cap full)
    const next = fire(deps, 7).catch(() => {}); // queued behind it
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(6); // both still queued

    ac.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(6); // aborted one never fetched

    settlers[0](mkRes(200)); // free an active slot
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(7); // the non-aborted queued tile runs
    settlers.forEach((s) => s(mkRes(200)));
    await Promise.all([...active, next]);
  });
});
