/**
 * #1121: a request that gets no response. `fetch` rejects with a
 * browser-worded `TypeError` ("Failed to fetch"); the request layer turns it
 * into one `NETWORK_ERROR`, worded for a read or a write, and leaves an
 * abort alone for its own handlers.
 */
import { jest } from "@jest/globals";
import React from "react";

const mockAuthValue = {
  session: {
    user: { name: "Ada" },
    isAuthenticated: true,
    isLoading: false,
    error: undefined as Error | undefined,
  },
  getToken: jest.fn(async () => "test-token"),
  login: { withGoogle: jest.fn(), withUniversal: jest.fn() },
  logout: jest.fn(),
};

jest.unstable_mockModule("../providers/Auth.provider", () => ({
  useAuth: () => mockAuthValue,
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  AuthContext: React.createContext(mockAuthValue),
}));

const { renderHook } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const {
  useAuthFetch,
  useAuthMutation,
  ApiError,
  NETWORK_ERROR_READ_MESSAGE,
  NETWORK_ERROR_WRITE_MESSAGE,
} = await import("../utils/api.util");
const { NETWORK_ERROR_CODE } = await import("../utils/permission-denied.util");

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider
    client={
      new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    }
  >
    {children}
  </QueryClientProvider>
);

const failingFetch = (error: unknown) => {
  global.fetch = jest.fn<typeof fetch>(() => Promise.reject(error));
};

describe("a request with no response (#1121)", () => {
  it("rejects a write with NETWORK_ERROR, not the browser's text", async () => {
    failingFetch(new TypeError("Failed to fetch"));
    const { result } = renderHook(
      () =>
        useAuthMutation<unknown, { id: string }>({
          url: (v) => `/api/stations/${v.id}/tags`,
          method: "POST",
          body: () => ({ entityTagId: "tag-1" }),
        }),
      { wrapper }
    );
    const error = await result.current
      .mutateAsync({ id: "s1" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: NETWORK_ERROR_CODE,
      status: 0,
      message: NETWORK_ERROR_WRITE_MESSAGE,
    });
    // #753: a write may have landed before the connection dropped.
    expect(NETWORK_ERROR_WRITE_MESSAGE).toMatch(
      /check whether the change saved/
    );
  });

  it("words a read's failure for a read", async () => {
    failingFetch(
      new TypeError("NetworkError when attempting to fetch resource.")
    );
    const { result } = renderHook(() => useAuthFetch());
    const error = await result.current
      .fetchWithAuth("/api/stations")
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: NETWORK_ERROR_CODE,
      message: NETWORK_ERROR_READ_MESSAGE,
    });
  });

  it("passes an abort through untouched", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    failingFetch(abort);
    const { result } = renderHook(() => useAuthFetch());
    const error = await result.current
      .fetchWithAuth("/api/stations")
      .catch((e: unknown) => e);
    expect(error).toBe(abort);
  });
});
