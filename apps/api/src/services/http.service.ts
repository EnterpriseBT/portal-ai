import { ApiErrorResponse, ApiSuccessResponse } from "@portalai/core/contracts";
import { Response } from "express";
import { ApiCode } from "../constants/api-codes.constants.js";

/**
 * Options-bag shape for the fourth argument of `new ApiError(...)`.
 * Distinguished from the legacy plain-record `details` by the presence
 * of a string-typed `recommendation` key.
 */
export interface ApiErrorOptions {
  recommendation?: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  status?: number;
  code: ApiCode;
  recommendation?: string;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    code: ApiCode,
    message: string,
    optionsOrDetails?: ApiErrorOptions | Record<string, unknown>
  ) {
    super(message);
    this.status = status;
    this.code = code;
    // Distinguish the options-bag shape from a legacy details map by
    // the presence of a string-typed `recommendation` key.
    if (typeof optionsOrDetails?.recommendation === "string") {
      const opts = optionsOrDetails as ApiErrorOptions;
      this.recommendation = opts.recommendation;
      this.details = opts.details;
    } else {
      this.details = optionsOrDetails as Record<string, unknown> | undefined;
    }
  }
}

export class HttpService {
  public static ApiError = ApiError;
  public static ApiCode = ApiCode;

  public static async success<P>(
    res: Response,
    payload: P,
    status: number = 200
  ) {
    return res.status(status).json({
      success: true,
      payload,
    } as ApiSuccessResponse<P>);
  }
  public static async error(res: Response, error: ApiError) {
    return res.status(error.status ?? 500).json({
      success: false,
      message: error.message,
      code: error.code,
      ...(error.recommendation ? { recommendation: error.recommendation } : {}),
      ...(error.details ? { details: error.details } : {}),
    } as ApiErrorResponse);
  }
}
