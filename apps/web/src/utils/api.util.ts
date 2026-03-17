import { useAuth0 } from "@auth0/auth0-react";
import {
  useMutation,
  useQuery,
  type UseMutationOptions,
  type UseQueryOptions,
  type QueryKey,
} from "@tanstack/react-query";
import { useCallback } from "react";
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "@portalai/core/contracts";
import { handleAuthError } from "./auth-error.util";

export class ApiError extends Error {
  code: string;
  status: number;
  success: false;

  constructor(message: string, code: string, status: number = 0) {
    super(message);
    this.code = code;
    this.status = status;
    this.success = false;
  }
}

/**
 * Hook that returns an authenticated fetch function.
 * Retrieves the access token from Auth0 and attaches it as a Bearer token.
 *
 * Usage:
 *   const { fetchWithAuth } = useAuthFetch();
 *   const data = await fetchWithAuth("/api/profile");
 */
export const useAuthFetch = () => {
  const { getAccessTokenSilently } = useAuth0();

  const fetchWithAuth = useCallback(
    async <T>(url: string, options: RequestInit = {}): Promise<T> => {
      let token: string;
      try {
        token = await getAccessTokenSilently({
          authorizationParams: {
            audience: import.meta.env.VITE_AUTH0_AUDIENCE,
          },
        });
      } catch (error) {
        handleAuthError();
        throw error;
      }

      const response = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const body = (await response.json()) as ApiErrorResponse;
        throw new ApiError(body.message, body.code, response.status);
      }

      return response.json() as Promise<T>;
    },
    [getAccessTokenSilently]
  );

  return { fetchWithAuth };
};

/**
 * Hook that wraps `useQuery` with authenticated fetching via Auth0.
 * Automatically attaches a Bearer token to every request.
 *
 * @param queryKey - A unique TanStack Query key for caching/invalidation.
 * @param url      - The API endpoint to fetch.
 * @param options  - Optional `RequestInit` overrides (method, headers, body, etc.).
 * @param queryOptions - Optional `useQuery` options (enabled, staleTime, retry, etc.).
 *
 * Usage:
 *   const { data, isLoading, error } = useAuthQuery<Profile>(
 *     ["profile"],
 *     "/api/profile",
 *   );
 */
export const useAuthQuery = <T>(
  queryKey: QueryKey,
  url: string,
  options?: RequestInit,
  queryOptions?: Omit<
    UseQueryOptions<T, ApiError, T, QueryKey>,
    "queryKey" | "queryFn"
  >
) => {
  const { fetchWithAuth } = useAuthFetch();

  return useQuery<T, ApiError, T, QueryKey>({
    queryKey,
    queryFn: async () => {
      const response = await fetchWithAuth<ApiSuccessResponse<T>>(url, options);
      return response.payload;
    },
    ...queryOptions,
  });
};

interface AuthMutationConfig<TData, TVariables> {
  url: string;
  method?: string;
  options?: Omit<RequestInit, "method" | "body">;
  mutationOptions?: Omit<
    UseMutationOptions<TData, ApiError, TVariables>,
    "mutationFn"
  >;
}

/**
 * Hook that wraps `useMutation` with authenticated fetching via Auth0.
 * Automatically attaches a Bearer token to every request.
 *
 * @param config.url             - The API endpoint to send the mutation to.
 * @param config.method          - HTTP method (defaults to "POST").
 * @param config.options         - Optional `RequestInit` overrides (headers, etc.).
 * @param config.mutationOptions - Optional `useMutation` options (onSuccess, onError, retry, etc.).
 *
 * Usage:
 *   const { mutate, isPending, error } = useAuthMutation<Profile, CreateProfilePayload>({
 *     url: "/api/profile",
 *   });
 *   mutate({ name: "Alice" });
 *
 *   // With DELETE (no body):
 *   const { mutate: remove } = useAuthMutation<void, void>({
 *     url: "/api/profile/123",
 *     method: "DELETE",
 *   });
 *   remove();
 */
export const useAuthMutation = <TData, TVariables>({
  url,
  method = "POST",
  options,
  mutationOptions,
}: AuthMutationConfig<TData, TVariables>) => {
  const { fetchWithAuth } = useAuthFetch();

  return useMutation<TData, ApiError, TVariables>({
    mutationFn: async (variables) => {
      const response = await fetchWithAuth<ApiSuccessResponse<TData>>(url, {
        ...options,
        method,
        ...(variables !== undefined && variables !== null
          ? { body: JSON.stringify(variables) }
          : {}),
      });
      return response.payload;
    },
    ...mutationOptions,
  });
};
