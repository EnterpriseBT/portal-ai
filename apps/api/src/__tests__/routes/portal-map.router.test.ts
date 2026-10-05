import { describe, it, expect, jest } from "@jest/globals";
import type { Response } from "express";

import {
  applyTileErrorHeaders,
  parseTileCoords,
} from "../../routes/portal-map.router.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

describe("parseTileCoords (#316)", () => {
  it("parses a valid tile address", () => {
    expect(parseTileCoords("8", "40", "98")).toEqual({ z: 8, x: 40, y: 98 });
  });

  it("strips a trailing .mvt from y", () => {
    expect(parseTileCoords("2", "1", "3.mvt")).toEqual({ z: 2, x: 1, y: 3 });
  });

  it("accepts z = 0 with x = y = 0", () => {
    expect(parseTileCoords("0", "0", "0")).toEqual({ z: 0, x: 0, y: 0 });
  });

  it("accepts the max valid coordinate for a zoom (2^z - 1)", () => {
    // zoom 3 → 8 tiles per axis → max index 7
    expect(parseTileCoords("3", "7", "7")).toEqual({ z: 3, x: 7, y: 7 });
  });

  const expectBadRequest = (fn: () => void) => {
    try {
      fn();
      throw new Error("expected parseTileCoords to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(400);
      expect((err as ApiError).code).toBe(ApiCode.MAP_TILE_NOT_FOUND);
    }
  };

  it("rejects a zoom above 22", () => {
    expectBadRequest(() => parseTileCoords("23", "0", "0"));
  });

  it("rejects a negative zoom", () => {
    expectBadRequest(() => parseTileCoords("-1", "0", "0"));
  });

  it("rejects x >= 2^z", () => {
    // zoom 2 → 4 tiles per axis → index 4 is out of range
    expectBadRequest(() => parseTileCoords("2", "4", "0"));
  });

  it("rejects y >= 2^z", () => {
    expectBadRequest(() => parseTileCoords("2", "0", "4"));
  });

  it("rejects negative coordinates", () => {
    expectBadRequest(() => parseTileCoords("5", "-1", "0"));
  });

  it("rejects non-integer coordinates", () => {
    expectBadRequest(() => parseTileCoords("5", "1.5", "0"));
  });
});

describe("applyTileErrorHeaders (#698)", () => {
  const fakeRes = () => {
    const setHeader = jest.fn();
    return { res: { setHeader } as unknown as Response, setHeader };
  };

  it("sets Retry-After from a MAP_TILE_BUSY error's retry hint", () => {
    const { res, setHeader } = fakeRes();
    applyTileErrorHeaders(
      res,
      new ApiError(503, ApiCode.MAP_TILE_BUSY, "busy", {
        retryAfterSeconds: 2,
      })
    );
    expect(setHeader).toHaveBeenCalledWith("Retry-After", "2");
  });

  it("sets nothing for other errors", () => {
    const { res, setHeader } = fakeRes();
    applyTileErrorHeaders(
      res,
      new ApiError(504, ApiCode.MAP_TILE_TIMEOUT, "slow")
    );
    applyTileErrorHeaders(res, new Error("boom"));
    expect(setHeader).not.toHaveBeenCalled();
  });
});
