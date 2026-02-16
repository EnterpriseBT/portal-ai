import { Auth0UserProfile } from "./auth.interfaces.js";

/**
 * Base API response interface
 */
export interface ApiResponse {
  success: boolean;
}

/**
 * API success response
 */
export interface ApiSuccessResponse<P> extends ApiResponse {
  success: true;
  payload: P;
}

/**
 * API error response
 */
export interface ApiErrorResponse extends ApiResponse {
  success: false;
  message: string;
  code: string;
}

/**
 * Health check response
 */
export interface HealthGetResponse {
  timestamp: string;
}

/**
 * User profile API response
 */
export interface UserProfileGetResponse {
  profile: Auth0UserProfile;
}
