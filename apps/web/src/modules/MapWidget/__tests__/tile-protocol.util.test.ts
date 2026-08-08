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

  it("reports a timeout and returns empty bytes on 504", async () => {
    const { statuses, deps } = harness(mkRes(504));
    const out = await fetchTile(
      protocolTileUrl("ctx1", "/api/portal-map/tiles/pin/p1/5/1/1.mvt"),
      undefined,
      deps
    );
    expect(statuses[0]).toMatchObject({ timedOut: true });
    expect(out.data.byteLength).toBe(0);
  });

  it("returns empty bytes for an empty (204) tile", async () => {
    const { deps } = harness(mkRes(204));
    const out = await fetchTile(
      protocolTileUrl("ctx1", "/api/portal-map/tiles/pin/p1/5/1/1.mvt"),
      undefined,
      deps
    );
    expect(out.data.byteLength).toBe(0);
  });
});
