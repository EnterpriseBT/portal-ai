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

export interface ServerError {
  message: string;
  code: string;
}

export function toServerError(
  error: ApiError | null | undefined
): ServerError | null {
  return error
    ? { message: error.message, code: error.code || "UNKNOWN_CODE" }
    : null;
}

export function resolveApiUrl(path: string): string {
  return `${import.meta.env.VITE_API_BASE_URL}${path}`;
}

export class ApiError extends Error {
  code: string;
  status: number;
  success: false;
  details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    status: number = 0,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.success = false;
    this.details = details;
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

      // FormData payloads must reach the server with the browser-generated
      // multipart boundary intact — setting Content-Type here would strip it.
      const isFormData =
        typeof FormData !== "undefined" && options.body instanceof FormData;

      const headers: Record<string, string> = {
        ...(options.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
      };
      if (!isFormData) {
        headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
      }

      const response = await fetch(resolveApiUrl(url), {
        ...options,
        headers,
      });

      if (!response.ok) {
        const body = (await response.json()) as ApiErrorResponse;
        throw new ApiError(
          body.message,
          body.code,
          response.status,
          body.details
        );
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
  url: string | ((variables: TVariables) => string);
  /**
   * Extracts the request body from the mutation variables. When omitted,
   * the full `variables` object is sent as the body (preserving the
   * original behavior). Return `undefined` to send no body — useful when
   * the variables are only used to build the URL.
   */
  body?: (variables: TVariables) => unknown;
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
  body,
  method = "POST",
  options,
  mutationOptions,
}: AuthMutationConfig<TData, TVariables>) => {
  const { fetchWithAuth } = useAuthFetch();

  return useMutation<TData, ApiError, TVariables>({
    mutationFn: async (variables) => {
      const resolvedUrl = typeof url === "function" ? url(variables) : url;
      const bodyPayload = body ? body(variables) : variables;
      const isFormData =
        typeof FormData !== "undefined" && bodyPayload instanceof FormData;
      const response = await fetchWithAuth<ApiSuccessResponse<TData>>(
        resolvedUrl,
        {
          ...options,
          method,
          ...(bodyPayload !== undefined && bodyPayload !== null
            ? {
                body: isFormData
                  ? (bodyPayload as BodyInit)
                  : JSON.stringify(bodyPayload),
              }
            : {}),
        }
      );
      return response.payload;
    },
    ...mutationOptions,
  });
};
