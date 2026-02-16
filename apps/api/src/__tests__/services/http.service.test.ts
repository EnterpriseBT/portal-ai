import { jest, describe, it, expect } from "@jest/globals";
import { ApiError, HttpService } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import type { Response } from "express";

/** Create a mock Express Response */
function createMockResponse(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe("HttpService", () => {
  describe("success()", () => {
    it("should return 200 with success payload by default", async () => {
      const res = createMockResponse();
      const payload = { data: "hello" };

      await HttpService.success(res, payload);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        payload: { data: "hello" },
      });
    });

    it("should return a custom status code when specified", async () => {
      const res = createMockResponse();
      const payload = { id: 1 };

      await HttpService.success(res, payload, 201);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        payload: { id: 1 },
      });
    });

    it("should handle null payload", async () => {
      const res = createMockResponse();

      await HttpService.success(res, null);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        payload: null,
      });
    });
  });

  describe("error()", () => {
    it("should return the error status, message, and code", async () => {
      const res = createMockResponse();
      const error = new ApiError(
        400,
        ApiCode.PROFILE_MISSING_TOKEN,
        "Bad request"
      );

      await HttpService.error(res, error);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Bad request",
        code: ApiCode.PROFILE_MISSING_TOKEN,
      });
    });

    it("should default to 500 when error status is undefined", async () => {
      const res = createMockResponse();
      const error = new ApiError(
        undefined as unknown as number,
        ApiCode.HEALTH_CHECK_FAILED,
        "Something went wrong"
      );

      await HttpService.error(res, error);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});

describe("ApiError", () => {
  it("should be an instance of Error", () => {
    const error = new ApiError(404, ApiCode.PROFILE_FETCH_FAILED, "Not found");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
  });

  it("should store status, code, and message correctly", () => {
    const error = new ApiError(
      422,
      ApiCode.PROFILE_INVALID_RESPONSE,
      "Invalid data"
    );

    expect(error.status).toBe(422);
    expect(error.code).toBe(ApiCode.PROFILE_INVALID_RESPONSE);
    expect(error.message).toBe("Invalid data");
  });
});
