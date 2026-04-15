import { QueryCache, QueryClient, MutationCache } from "@tanstack/react-query";

import { ApiError, handleAuthError } from "./utils";

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
      retry: (failureCount, error) => {
        if (error instanceof ApiError) {
          if (error.status === 401) return false;
          if (error.code === "ORGANIZATION_USER_NOT_FOUND") return false;
        }
        return failureCount < 3;
      },
    },
    mutations: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError) {
          if (error.status === 401) return false;
          if (error.code === "ORGANIZATION_USER_NOT_FOUND") return false;
        }
        return failureCount < 3;
      },
    },
  },
});
