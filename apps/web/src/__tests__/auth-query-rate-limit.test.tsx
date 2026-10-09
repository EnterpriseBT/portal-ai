/**
 * #747: `fetchWithAuth` reads a 429's `Retry-After` onto the error and pauses
 * every GET tab-wide on `API_RATE_LIMITED`, so a read issued during the
 * window waits instead of spending a refused request. Writes never wait.
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

const { renderHook, waitFor } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { useAuthFetch, useAuthQuery, ApiError } =
  await import("../utils/api.util");
const { apiReadPauseRemainingMs, pauseApiReads, resetApiReadPause } =
  await import("../utils/rate-limit.util");

const rateLimitedBody = (seconds: number) => ({
  success: false,
  message: `Too many requests. Try again in ${seconds} seconds.`,
  code: "API_RATE_LIMITED",
  details: { retryAfterSeconds: seconds },
});

const response = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) =>
  ({
    ok: status < 400,
    status,
    headers: new Headers(headers),
    json: async () => body,
  }) as Response;

const renderQuery = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useAuthQuery<string>(["probe"], "/api/probe"), {
    wrapper,
  });
};

const renderFetch = () =>
  renderHook(() => useAuthFetch()).result.current.fetchWithAuth;

beforeEach(() => {
  resetApiReadPause();
  // No release spread: the timing assertions stay exact.
  jest.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("fetchWithAuth on a 429 (#747)", () => {
  it("puts the Retry-After header's seconds on the error", async () => {
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        response(429, rateLimitedBody(40), { "Retry-After": "42" })
      );
    const { result } = renderQuery();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error?.retryAfterSeconds).toBe(42);
  });

  it("falls back to details.retryAfterSeconds without the header", async () => {
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue(response(429, rateLimitedBody(17)));
    const { result } = renderQuery();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.retryAfterSeconds).toBe(17);
  });

  it("leaves retryAfterSeconds unset on other errors", async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue(
      response(404, {
        success: false,
        message: "Not found",
        code: "STATION_NOT_FOUND",
      })
    );
    const { result } = renderQuery();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.retryAfterSeconds).toBeUndefined();
  });
});

describe("useAuthQuery read pause (#747)", () => {
  it("pauses reads for the window on API_RATE_LIMITED", async () => {
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        response(429, rateLimitedBody(30), { "Retry-After": "30" })
      );
    const { result } = renderQuery();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(apiReadPauseRemainingMs()).toBeGreaterThan(29_000);
  });

  it("does not pause on a map-tile 429", async () => {
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        response(
          429,
          { ...rateLimitedBody(30), code: "MAP_TILE_RATE_LIMITED" },
          { "Retry-After": "30" }
        )
      );
    const { result } = renderQuery();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(apiReadPauseRemainingMs()).toBe(0);
  });

  it("holds a read issued during the pause until it ends", async () => {
    jest.useFakeTimers();
    try {
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockResolvedValue(response(200, { success: true, payload: "ok" }));
      global.fetch = fetchMock;
      pauseApiReads(5_000);

      const { result } = renderQuery();
      await jest.advanceTimersByTimeAsync(4_000);
      expect(fetchMock).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(result.current.data).toBe("ok"));
    } finally {
      jest.useRealTimers();
    }
  });

  it("never sends a held read whose query was unmounted", async () => {
    jest.useFakeTimers();
    try {
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockResolvedValue(response(200, { success: true, payload: "ok" }));
      global.fetch = fetchMock;
      pauseApiReads(5_000);

      const { unmount } = renderQuery();
      await jest.advanceTimersByTimeAsync(1_000);
      unmount();
      await jest.advanceTimersByTimeAsync(10_000);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("fetchWithAuth read pause, outside useAuthQuery (#747)", () => {
  it("holds a GET issued during the pause", async () => {
    jest.useFakeTimers();
    try {
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockResolvedValue(response(200, { success: true, payload: "ok" }));
      global.fetch = fetchMock;
      const fetchWithAuth = renderFetch();
      pauseApiReads(5_000);

      const pending = fetchWithAuth("/api/search?q=a");
      await jest.advanceTimersByTimeAsync(4_000);
      expect(fetchMock).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1_000);
      await expect(pending).resolves.toEqual({ success: true, payload: "ok" });
    } finally {
      jest.useRealTimers();
    }
  });

  it("starts the pause on a refused GET", async () => {
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        response(429, rateLimitedBody(30), { "Retry-After": "30" })
      );
    const fetchWithAuth = renderFetch();
    await expect(fetchWithAuth("/api/search?q=a")).rejects.toBeInstanceOf(
      ApiError
    );
    expect(apiReadPauseRemainingMs()).toBeGreaterThan(29_000);
  });

  it("sends a write at once during the pause, and a refused write starts none", async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        response(429, rateLimitedBody(30), { "Retry-After": "30" })
      );
    global.fetch = fetchMock;
    const fetchWithAuth = renderFetch();

    await expect(
      fetchWithAuth("/api/stations", { method: "POST", body: "{}" })
    ).rejects.toMatchObject({
      code: "API_RATE_LIMITED",
      retryAfterSeconds: 30,
    });
    expect(apiReadPauseRemainingMs()).toBe(0);

    pauseApiReads(10_000);
    await expect(
      fetchWithAuth("/api/stations", { method: "POST", body: "{}" })
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
