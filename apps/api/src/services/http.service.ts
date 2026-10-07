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

/**
 * #687: the message a 500 answers with. A 500's own message is whatever the
 * handler caught, often a Drizzle error carrying the SQL text and its bound
 * params, so it never reaches the client. The catch-all logs it first.
 */
export const INTERNAL_ERROR_MESSAGE = "Internal server error";

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
    const status = error.status ?? 500;
    // #687: a 500 keeps its code (the client contract) and its authored
    // recommendation; the caught message and the free-form details stay in
    // the log. Other 5xx (503 backpressure, 502 upstream refusals) carry
    // copy written for the user and pass through.
    const internal = status === 500;
    return res.status(status).json({
      success: false,
      message: internal ? INTERNAL_ERROR_MESSAGE : error.message,
      code: error.code,
      ...(error.recommendation ? { recommendation: error.recommendation } : {}),
      ...(error.details && !internal ? { details: error.details } : {}),
    } as ApiErrorResponse);
  }
}
