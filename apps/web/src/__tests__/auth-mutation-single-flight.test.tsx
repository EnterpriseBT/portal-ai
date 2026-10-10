/**
 * #751: `useAuthMutation` sends one request per submit intent. A call whose
 * request (method, resolved URL, serialized body) is already in flight from
 * the same hook doesn't send: a double-click, a double Enter, click then
 * Enter, or a twice-pressed Confirm all reach the server once. Different
 * requests from one hook still run in parallel.
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

const { renderHook, waitFor, act } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { useAuthMutation } = await import("../utils/api.util");

type Settle = { ok: (payload: unknown) => void; fail: () => void };

/** A fetch whose responses the test settles by hand, in call order. */
const deferredFetch = () => {
  const pending: Settle[] = [];
  const fetchMock = jest.fn<typeof fetch>(
    () =>
      new Promise<Response>((resolve) => {
        pending.push({
          ok: (payload) =>
            resolve({
              ok: true,
              status: 200,
              headers: new Headers(),
              json: async () => ({ success: true, payload }),
            } as Response),
          fail: () =>
            resolve({
              ok: false,
              status: 409,
              headers: new Headers(),
              json: async () => ({
                success: false,
                message: "Conflict",
                code: "STATION_CONFLICT",
              }),
            } as Response),
        });
      })
  );
  global.fetch = fetchMock;
  return { fetchMock, pending };
};

type Vars = { id: string; name?: string };

const renderMutation = (
  config: Partial<Parameters<typeof useAuthMutation<unknown, Vars>>[0]> = {}
) => {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useAuthMutation<unknown, Vars>({
        url: (v) => `/api/stations/${v.id}`,
        method: "PATCH",
        body: (v) => ({ name: v.name }),
        ...config,
      }),
    { wrapper }
  );
};

/** Lets the hook's async token fetch reach `fetch`. */
const flush = () => act(async () => {});

describe("useAuthMutation single-flight (#751)", () => {
  it("sends one request for the same call made twice while pending", async () => {
    const { fetchMock, pending } = deferredFetch();
    const { result } = renderMutation();

    act(() => {
      result.current.mutate({ id: "s1", name: "A" });
      result.current.mutate({ id: "s1", name: "A" });
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    pending[0].ok({});
  });

  it("sends again once the first request has settled", async () => {
    const { fetchMock, pending } = deferredFetch();
    const { result } = renderMutation();

    act(() => result.current.mutate({ id: "s1", name: "A" }));
    await flush();
    await act(async () => pending[0].ok({}));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => result.current.mutate({ id: "s1", name: "A" }));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending[1].ok({});
  });

  it("sends again after the first request failed", async () => {
    const { fetchMock, pending } = deferredFetch();
    const { result } = renderMutation();

    act(() => result.current.mutate({ id: "s1", name: "A" }));
    await flush();
    await act(async () => pending[0].fail());
    await waitFor(() => expect(result.current.isError).toBe(true));

    act(() => result.current.mutate({ id: "s1", name: "A" }));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending[1].ok({});
  });

  it("runs different URLs in parallel (two rows at once)", async () => {
    const { fetchMock, pending } = deferredFetch();
    const { result } = renderMutation();

    act(() => {
      result.current.mutate({ id: "s1", name: "A" });
      result.current.mutate({ id: "s2", name: "A" });
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending.forEach((p) => p.ok({}));
  });

  it("runs the same URL with different bodies in parallel", async () => {
    const { fetchMock, pending } = deferredFetch();
    const { result } = renderMutation();

    act(() => {
      result.current.mutate({ id: "s1", name: "A" });
      result.current.mutate({ id: "s1", name: "B" });
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending.forEach((p) => p.ok({}));
  });

  it("gives a duplicate mutateAsync the in-flight result", async () => {
    const { fetchMock, pending } = deferredFetch();
    const { result } = renderMutation();

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.mutateAsync({ id: "s1", name: "A" });
      second = result.current.mutateAsync({ id: "s1", name: "A" });
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => pending[0].ok({ id: "s1" }));
    await expect(first).resolves.toEqual({ id: "s1" });
    await expect(second).resolves.toEqual({ id: "s1" });
  });

  it("sends every call when dedupeInFlight is false", async () => {
    const { fetchMock, pending } = deferredFetch();
    const { result } = renderMutation({ dedupeInFlight: false });

    act(() => {
      result.current.mutate({ id: "s1", name: "A" });
      result.current.mutate({ id: "s1", name: "A" });
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending.forEach((p) => p.ok({}));
  });

  it("does not dedupe a FormData body", async () => {
    const { fetchMock, pending } = deferredFetch();
    const { result } = renderMutation({
      method: "POST",
      url: "/api/uploads",
      body: () => new FormData(),
    });

    act(() => {
      result.current.mutate({ id: "u1" });
      result.current.mutate({ id: "u1" });
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending.forEach((p) => p.ok({}));
  });

  it("runs only the first call's per-call callbacks", async () => {
    const { pending } = deferredFetch();
    const { result } = renderMutation();
    const firstSuccess = jest.fn();
    const droppedSuccess = jest.fn();

    act(() => {
      result.current.mutate(
        { id: "s1", name: "A" },
        { onSuccess: firstSuccess }
      );
      result.current.mutate(
        { id: "s1", name: "A" },
        { onSuccess: droppedSuccess }
      );
    });
    await flush();
    await act(async () => pending[0].ok({}));

    await waitFor(() => expect(firstSuccess).toHaveBeenCalledTimes(1));
    expect(droppedSuccess).not.toHaveBeenCalled();
  });

  it("keeps mutate and mutateAsync stable across rerenders", () => {
    deferredFetch();
    const { result, rerender } = renderMutation();
    const { mutate, mutateAsync } = result.current;
    rerender();
    expect(result.current.mutate).toBe(mutate);
    expect(result.current.mutateAsync).toBe(mutateAsync);
  });
});

// #753: regressions from #751's guard, plus automatic write retries.
describe("useAuthMutation request guard fixes (#753)", () => {
  /** A client whose mutations retry by default (once, at once), so a test
   *  can tell a write that opts out from a read that inherits it. */
  const renderWith = <V,>(
    config: Parameters<typeof useAuthMutation<unknown, V>>[0]
  ) => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: 1, retryDelay: 0 } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return renderHook(() => useAuthMutation<unknown, V>(config), { wrapper });
  };

  const failingFetch = () => {
    const fetchMock = jest.fn<typeof fetch>(() =>
      Promise.reject(new TypeError("Failed to fetch"))
    );
    global.fetch = fetchMock;
    return fetchMock;
  };

  it("routes a throwing url() to onError instead of throwing from mutate", async () => {
    deferredFetch();
    const onError = jest.fn();
    const { result } = renderWith<{ id?: string }>({
      url: (v) => `/api/stations/${v.id!.toUpperCase()}`,
      method: "PATCH",
      mutationOptions: { onError },
    });

    expect(() => act(() => result.current.mutate({}))).not.toThrow();
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(result.current.error).toBeInstanceOf(TypeError);
  });

  it("routes an unserializable body to onError", async () => {
    deferredFetch();
    const onError = jest.fn();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const { result } = renderWith<Record<string, unknown>>({
      url: "/api/stations",
      mutationOptions: { onError },
    });

    expect(() => act(() => result.current.mutate(circular))).not.toThrow();
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  });

  it("does not dedupe GET requests (a fresh read never joins a stale one)", async () => {
    const { fetchMock, pending } = deferredFetch();
    const { result } = renderWith<{ q: string }>({
      url: (v) => `/api/search?q=${v.q}`,
      method: "GET",
      body: () => undefined,
    });

    act(() => {
      result.current.mutate({ q: "a" });
      result.current.mutate({ q: "a" });
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending.forEach((p) => p.ok({}));
  });

  it("does not retry a write that failed in transit", async () => {
    const fetchMock = failingFetch();
    const { result } = renderWith<{ name: string }>({ url: "/api/stations" });

    act(() => result.current.mutate({ name: "A" }));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the default retry for a GET-shaped read", async () => {
    const fetchMock = failingFetch();
    const { result } = renderWith<{ q: string }>({
      url: (v) => `/api/search?q=${v.q}`,
      method: "GET",
      body: () => undefined,
    });

    act(() => result.current.mutate({ q: "a" }));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lets a caller's explicit retry win for a write", async () => {
    const fetchMock = failingFetch();
    const { result } = renderWith<{ name: string }>({
      url: "/api/stations",
      mutationOptions: { retry: 1, retryDelay: 0 },
    });

    act(() => result.current.mutate({ name: "A" }));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
