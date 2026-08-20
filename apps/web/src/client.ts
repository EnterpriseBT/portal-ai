import { QueryCache, QueryClient, MutationCache } from "@tanstack/react-query";

import { ApiError, handleAuthError } from "./utils";

/**
 * Shared retry rule for queries and mutations.
 *
 * A 4xx is a verdict about the request itself — a missing row, a state
 * conflict, a precondition on a connected account — so re-issuing it
 * cannot change the answer. Retrying one only delays the error the user
 * needs to act on (three round-trips' worth) and repeats whatever work
 * the server did to reject it. 5xx and transport failures keep their
 * retries, since those can genuinely succeed on a second attempt.
 *
 * The 401 and `ORGANIZATION_USER_NOT_FOUND` checks predate the 4xx rule
 * and stay: the code check has to fire regardless of status.
 */
const shouldRetry = (failureCount: number, error: Error): boolean => {
  if (error instanceof ApiError) {
    if (error.status === 401) return false;
    if (error.code === "ORGANIZATION_USER_NOT_FOUND") return false;
    if (error.status >= 400 && error.status < 500) return false;
  }
  return failureCount < 3;
};

const onAuthError = (error: Error) => {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.code === "ORGANIZATION_USER_NOT_FOUND") {
      handleAuthError();
    }
  }
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      retry: shouldRetry,
    },
    mutations: {
      retry: shouldRetry,
    },
  },
});
