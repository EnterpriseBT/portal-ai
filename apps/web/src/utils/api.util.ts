import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
  type QueryKey,
} from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useRef } from "react";
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "@portalai/core/contracts";
import { useAuth } from "../providers/Auth.provider";
import { handleAuthError } from "./auth-error.util";
import { isPermissionDenied } from "./permission-denied.util";
import {
  apiReadPauseRemainingMs,
  isApiRateLimited,
  pauseApiReads,
  retryAfterMs,
  waitForApiReadPause,
} from "./rate-limit.util";

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
  // `?.` because `import.meta.env` does not exist outside a Vite build (jest,
  // node scripts) — the value is always set in a real build.
  return `${import.meta.env?.VITE_API_BASE_URL ?? ""}${path}`;
}

export class ApiError extends Error {
  code: string;
  status: number;
  success: false;
  details?: Record<string, unknown>;
  /** A 429's wait, from `Retry-After` or `details.retryAfterSeconds` (#747). */
  retryAfterSeconds?: number;

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
 * A 429's wait in seconds (#747): the `Retry-After` header (integer seconds,
 * which is all our limiter sends), else `details.retryAfterSeconds`.
 */
function retryAfterSecondsOf(
  response: Response,
  body: ApiErrorResponse
): number | undefined {
  const header = Number.parseInt(
    response.headers?.get("Retry-After") ?? "",
    10
  );
  if (Number.isFinite(header)) return header;
  const detail = body.details?.retryAfterSeconds;
  return typeof detail === "number" ? detail : undefined;
}

/**
 * Hook that returns an authenticated fetch function.
 * Retrieves the access token from the auth seam (#607) and attaches it as a
 * Bearer token. The audience is resolved inside `getToken`, per provider.
 *
 * Usage:
 *   const { fetchWithAuth } = useAuthFetch();
 *   const data = await fetchWithAuth("/api/profile");
 */
export const useAuthFetch = () => {
  const { getToken } = useAuth();

  const fetchWithAuth = useCallback(
    async <T>(url: string, options: RequestInit = {}): Promise<T> => {
      // #747: every read honours the tab-wide rate-limit pause, whichever
      // hook issued it. Writes never wait: they report the server's wait.
      const isRead = (options.method ?? "GET").toUpperCase() === "GET";
      if (isRead) await waitForApiReadPause(options.signal ?? undefined);

      let token: string;
      try {
        token = await getToken();
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
        const error = new ApiError(
          body.message,
          body.code,
          response.status,
          body.details
        );
        if (response.status === 429) {
          error.retryAfterSeconds = retryAfterSecondsOf(response, body);
        }
        if (isRead && isApiRateLimited(error)) {
          pauseApiReads(retryAfterMs(error));
        }
        throw error;
      }

      return response.json() as Promise<T>;
    },
    [getToken]
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
    queryFn: async (context) => {
      // #747: hand react-query's signal over only while reads are paused, so
      // a query whose page goes away stops waiting and never sends. Reading
      // `context.signal` opts that query into abort-on-unmount, which every
      // other query must not change into.
      const signal = apiReadPauseRemainingMs() > 0 ? context.signal : undefined;
      const response = await fetchWithAuth<ApiSuccessResponse<T>>(
        url,
        signal ? { ...options, signal } : options
      );
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
  /**
   * #688: when the caller's access to the object changed, invalidate these
   * keys so affordances re-render from fresh capabilities. That's a
   * permission denial (`isPermissionDenied`, 403), or a 404 (#713): an
   * object the caller can no longer read answers 404 on every verb, as does
   * one deleted under them. Feedback stays with the caller (FormAlert in a
   * dialog, a toast elsewhere): the caller's `onError` still runs, after the
   * invalidation.
   */
  onPermissionDenied?: { invalidate: (variables: TVariables) => QueryKey[] };
  /**
   * #751: drop a call whose request (method, resolved URL, serialized body)
   * is already in flight from this hook, so a double-click, a double Enter or
   * click then Enter sends once. True by default. Set false only for an
   * endpoint that must receive identical concurrent requests.
   */
  dedupeInFlight?: boolean;
}

interface BuiltRequest {
  method: string;
  url: string;
  bodyPayload: unknown;
  isBinary: boolean;
}

/** The request a mutation sends for `variables`. One function builds both
 *  the request and its in-flight key, so the two can't disagree. */
function buildRequest<TVariables>(
  config: {
    url: string | ((variables: TVariables) => string);
    body?: (variables: TVariables) => unknown;
    method: string;
  },
  variables: TVariables
): BuiltRequest {
  const url =
    typeof config.url === "function" ? config.url(variables) : config.url;
  const bodyPayload = config.body ? config.body(variables) : variables;
  const isBinary =
    (typeof FormData !== "undefined" && bodyPayload instanceof FormData) ||
    (typeof Blob !== "undefined" && bodyPayload instanceof Blob);
  return { method: config.method, url, bodyPayload, isBinary };
}

/**
 * #751: what makes two calls the same request: method, resolved URL and
 * serialized body. `null` for a binary body, which can't be compared and is
 * never deduped (no `useAuthMutation` caller sends one today).
 */
export function requestKey(req: BuiltRequest): string | null {
  if (req.isBinary) return null;
  const body =
    req.bodyPayload === undefined || req.bodyPayload === null
      ? ""
      : JSON.stringify(req.bodyPayload);
  return `${req.method} ${req.url} ${body}`;
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
  onPermissionDenied,
  dedupeInFlight = true,
}: AuthMutationConfig<TData, TVariables>) => {
  const { fetchWithAuth } = useAuthFetch();
  const queryClient = useQueryClient();

  const mutation = useMutation<TData, ApiError, TVariables>({
    mutationFn: async (variables) => {
      const request = buildRequest({ url, body, method }, variables);
      const response = await fetchWithAuth<ApiSuccessResponse<TData>>(
        request.url,
        {
          ...options,
          method,
          ...(request.bodyPayload !== undefined && request.bodyPayload !== null
            ? {
                body: request.isBinary
                  ? (request.bodyPayload as BodyInit)
                  : JSON.stringify(request.bodyPayload),
              }
            : {}),
        }
      );
      return response.payload;
    },
    ...mutationOptions,
    ...(onPermissionDenied
      ? {
          onError: (error, variables, ...rest) => {
            if (isPermissionDenied(error.code) || error.status === 404) {
              for (const queryKey of onPermissionDenied.invalidate(variables)) {
                void queryClient.invalidateQueries({ queryKey });
              }
            }
            return mutationOptions?.onError?.(error, variables, ...rest);
          },
        }
      : {}),
  });

  // #751: requests in flight from this hook, by `requestKey`. Held in refs
  // and checked synchronously, so a second activation inside the render lag
  // (before `isPending` disables the button) can't send again.
  const inFlight = useRef(new Map<string, Promise<TData>>());
  const latest = useRef({ mutation, url, body, method, dedupeInFlight });
  // A layout effect, not a render-time write (refs aren't read or written
  // during render): it runs after each commit, before any later input.
  useLayoutEffect(() => {
    latest.current = { mutation, url, body, method, dedupeInFlight };
  });

  type MutateAsync = typeof mutation.mutateAsync;
  const mutateAsync = useCallback<MutateAsync>((variables, callOptions) => {
    const current = latest.current;
    const key = current.dedupeInFlight
      ? requestKey(buildRequest(current, variables))
      : null;
    if (key === null) {
      return current.mutation.mutateAsync(variables, callOptions);
    }
    const running = inFlight.current.get(key);
    if (running) return running;
    const request = current.mutation.mutateAsync(variables, callOptions);
    inFlight.current.set(key, request);
    void request
      .finally(() => {
        if (inFlight.current.get(key) === request) inFlight.current.delete(key);
      })
      .catch(() => {});
    return request;
  }, []);

  type Mutate = typeof mutation.mutate;
  // Like react-query's `mutate`: never throws; errors reach `onError` and
  // `mutation.error`.
  const mutate = useCallback<Mutate>(
    (variables, callOptions) => {
      void mutateAsync(variables, callOptions).catch(() => {});
    },
    [mutateAsync]
  );

  return { ...mutation, mutate, mutateAsync };
};
