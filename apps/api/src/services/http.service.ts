import { ApiErrorResponse, ApiSuccessResponse } from "@portalai/core/contracts";
import { Response } from "express";
import { ApiCode } from "../constants/api-codes.constants.js";

export class ApiError extends Error {
  status?: number;
  code: ApiCode;

  constructor(status: number, code: ApiCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
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
    } as ApiErrorResponse);
  }
}
