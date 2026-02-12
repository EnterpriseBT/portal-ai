import { Auth0UserProfile } from "./auth.types.js";

/**
 * Standard API response status enum
 */
export enum ApiResponseStatus {
  OK = "OK",
  ERROR = "ERROR",
}

/**
 * Base API response interface
 */
export interface ApiResponse {
  status: ApiResponseStatus;
}

/**
 * API success response
 */
export interface ApiSuccessResponse extends ApiResponse {
  status: ApiResponseStatus.OK;
}

/**
 * API error response
 */
export interface ApiErrorResponse extends ApiResponse {
  status: ApiResponseStatus.ERROR;
  message: string;
  code: string;
}

/**
 * Health check response
 */
export interface ApiGetHealthResponse extends ApiSuccessResponse {
  timestamp: string;
}

/**
 * User profile API response
 */
export interface ApiGetProfileResponse extends ApiSuccessResponse {
  profile: Auth0UserProfile;
}
