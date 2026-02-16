/** Auth contracts — schemas & types */
export {
  Auth0UserProfileSchema,
  UserProfileSchema,
  type Auth0UserProfile,
  type UserProfile,
} from "./auth.contracts.js";

/** API contracts — schemas & types */
export {
  ApiResponseSchema,
  ApiSuccessSchema,
  ApiErrorSchema,
  type ApiResponse,
  type ApiSuccessResponse,
  type ApiErrorResponse,
} from "./api.contracts.js";

/** Health contracts — schemas & types */
export {
  HealthGetResponseSchema,
  type HealthGetResponse,
} from "./health.contracts.js";

/** User profile response contracts — schemas & types */
export {
  UserProfileGetResponseSchema,
  type UserProfileGetResponse,
} from "./user-profile.contracts.js";
