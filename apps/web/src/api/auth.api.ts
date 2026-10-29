import type {
  Auth0UserProfileGetResponse,
  SsoDiscoveryRequestBody,
  SsoDiscoveryResponse,
} from "@portalai/core/contracts";
import { useAuthQuery, usePublicMutation } from "../utils/api.util";
import { useAuth } from "../providers/Auth.provider";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

// The `sdk.auth` facade is provider-agnostic: it delegates to the `useAuth()`
// seam (#607), which normalizes Auth0 (SaaS) or a generic OIDC client
// (residency). Consumers of `sdk.auth.*` are unchanged by the provider swap.
export const auth = {
  session: () => useAuth().session,

  login: () => useAuth().login,

  logout: () => ({ logout: useAuth().logout }),

  profile: (options?: QueryOptions<Auth0UserProfileGetResponse>) =>
    useAuthQuery<Auth0UserProfileGetResponse>(
      queryKeys.auth.profile(),
      "/api/profile",
      undefined,
      options
    ),

  /** #916: which enterprise connection a work email signs in through, for
   *  "Sign in with SSO". Anonymous: the caller is signed out. */
  ssoDiscovery: () =>
    usePublicMutation<SsoDiscoveryResponse, SsoDiscoveryRequestBody>({
      url: "/api/public/sso-discovery",
    }),
};
