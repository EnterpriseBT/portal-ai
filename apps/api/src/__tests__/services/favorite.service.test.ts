import { describe, it, expect, jest, afterEach } from "@jest/globals";

import { ApiCode } from "../../constants/api-codes.constants.js";
import { FavoriteService } from "../../services/favorite.service.js";
import { ApiError } from "../../services/http.service.js";
import { PermissionService } from "../../services/permission.service.js";
import type { PermissionContext } from "../../services/permission.service.js";

/** #1072: how FavoriteService reports a failure. */
const ctx: PermissionContext = {
  userId: "user-1",
  organizationId: "org-1",
  roles: ["member"],
};
const target = { type: "station" as const, id: "s-1" };

describe("FavoriteService errors (#1072)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(["set", "unset"] as const)(
    "%s wraps an unexpected failure as FAVORITE_UPDATE_FAILED",
    async (verb) => {
      jest
        .spyOn(PermissionService, "loadSet")
        .mockRejectedValue(new Error("connection reset"));
      await expect(FavoriteService[verb](ctx, target)).rejects.toMatchObject({
        status: 500,
        code: ApiCode.FAVORITE_UPDATE_FAILED,
      });
    }
  );

  it("passes an ApiError through unchanged", async () => {
    const refusal = new ApiError(404, ApiCode.STATION_NOT_FOUND, "nope");
    jest.spyOn(PermissionService, "loadSet").mockRejectedValue(refusal);
    await expect(FavoriteService.set(ctx, target)).rejects.toBe(refusal);
  });
});
