import { describe, it, expect } from "@jest/globals";

import type { BlockRef } from "@portalai/core";

import {
  readTileStatus,
  renderPopupTemplate,
  tilePath,
} from "../utils/tile-source.util";

const headers = (h: Record<string, string>) => ({
  get: (k: string) => h[k] ?? null,
});

describe("tilePath", () => {
  it("builds a message-block tile template", () => {
    const ref: BlockRef = { kind: "message", messageId: "m1", blockIndex: 3 };
    expect(tilePath(ref)).toBe(
      "/api/portal-map/tiles/message/m1/3/{z}/{x}/{y}.mvt"
    );
  });
  it("builds a pin tile template", () => {
    const ref: BlockRef = { kind: "pin", portalResultId: "pr1" };
    expect(tilePath(ref)).toBe("/api/portal-map/tiles/pin/pr1/{z}/{x}/{y}.mvt");
  });
  it("is null without a ref (unpersisted block can't tile)", () => {
    expect(tilePath(undefined)).toBeNull();
  });
});

describe("readTileStatus", () => {
  it("flags simplified / truncated from the response headers", () => {
    expect(
      readTileStatus(200, headers({ "X-Portal-Tile-Simplified": "4" }))
    ).toEqual({
      simplified: true,
      truncated: false,
      timedOut: false,
      aggregated: false,
    });
    expect(
      readTileStatus(200, headers({ "X-Portal-Tile-Truncated": "1" }))
    ).toMatchObject({ truncated: true });
  });
  it("flags a timeout from a 504", () => {
    expect(readTileStatus(504, headers({}))).toMatchObject({ timedOut: true });
  });
  it("flags an aggregated tile from the header (#330)", () => {
    expect(
      readTileStatus(200, headers({ "X-Portal-Tile-Aggregated": "1" }))
    ).toMatchObject({ aggregated: true });
  });
  it("is all-false for a clean tile", () => {
    expect(readTileStatus(200, headers({}))).toEqual({
      simplified: false,
      truncated: false,
      timedOut: false,
      aggregated: false,
    });
  });
});

describe("renderPopupTemplate", () => {
  it("substitutes present fields", () => {
    expect(
      renderPopupTemplate("{{address}} — {{prop_class}}", {
        address: "100 S Main",
        prop_class: "vacant",
      })
    ).toBe("100 S Main — vacant");
  });
  it("marks an unresolved field rather than leaving a blank (row 10)", () => {
    expect(
      renderPopupTemplate("{{address}} — {{missing}}", { address: "X" })
    ).toBe("X — ⟨missing⟩");
  });
});
