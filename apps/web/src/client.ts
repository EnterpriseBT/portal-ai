import { QueryCache, QueryClient, MutationCache } from "@tanstack/react-query";

import { ApiError, handleAuthError } from "./utils";

const onAuthError = (error: Error) => {
  if (error instanceof ApiError && error.status === 401) {
    handleAuthError();
  }
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status === 401) return false;
        return failureCount < 3;
      },
    },
    mutations: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status === 401) return false;
        return failureCount < 3;
      },
    },
  },
});
