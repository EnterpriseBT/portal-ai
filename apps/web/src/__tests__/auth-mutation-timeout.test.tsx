/**
 * #789: a write is bounded. Dialogs block dismissal while their request is
 * pending, so a write that never answers must still settle: after its
 * timeout it rejects with `REQUEST_TIMEOUT`, which the dialog shows through
 * FormAlert, and the dialog becomes dismissible again.
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

const { renderHook, act } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const {
  useAuthMutation,
  ApiError,
  WRITE_TIMEOUT_MS,
  LONG_WRITE_TIMEOUT_MS,
  REQUEST_TIMEOUT_MESSAGE,
} = await import("../utils/api.util");

/** A fetch that never answers on its own: it settles only when aborted. */
const hangingFetch = () => {
  const fetchMock = jest.fn<typeof fetch>(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason));
      })
  );
  global.fetch = fetchMock;
  return fetchMock;
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

/** Starts a mutation and reports how it settled, without awaiting it. */
const start = (mutateAsync: (v: Vars) => Promise<unknown>, vars: Vars) => {
  const outcome: { settled: boolean; error?: unknown } = { settled: false };
  mutateAsync(vars).then(
    () => (outcome.settled = true),
    (error: unknown) => {
      outcome.settled = true;
      outcome.error = error;
    }
  );
  return outcome;
};

describe("useAuthMutation write timeout (#789)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("bounds a write by WRITE_TIMEOUT_MS by default", async () => {
    hangingFetch();
    const { result } = renderMutation();
    expect(WRITE_TIMEOUT_MS).toBe(30_000);
    let outcome!: ReturnType<typeof start>;
    await act(async () => {
      outcome = start(result.current.mutateAsync, { id: "s1", name: "A" });
      await jest.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS - 1);
    });
    expect(outcome.settled).toBe(false);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(outcome.settled).toBe(true);
    expect((outcome.error as { code?: string }).code).toBe("REQUEST_TIMEOUT");
  });

  it("rejects with an ApiError saying the write may still finish", async () => {
    hangingFetch();
    const { result } = renderMutation();
    let outcome!: ReturnType<typeof start>;
    await act(async () => {
      outcome = start(result.current.mutateAsync, { id: "s1", name: "A" });
      await jest.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS);
    });
    expect(outcome.error).toBeInstanceOf(ApiError);
    const error = outcome.error as InstanceType<typeof ApiError>;
    expect(error.status).toBe(0);
    expect(error.message).toBe(REQUEST_TIMEOUT_MESSAGE);
    expect(REQUEST_TIMEOUT_MESSAGE).toMatch(/may still finish/);
  });

  it("lets an endpoint extend the bound", async () => {
    hangingFetch();
    const { result } = renderMutation({ timeoutMs: LONG_WRITE_TIMEOUT_MS });
    expect(LONG_WRITE_TIMEOUT_MS).toBe(300_000);
    let outcome!: ReturnType<typeof start>;
    await act(async () => {
      outcome = start(result.current.mutateAsync, { id: "s1", name: "A" });
      await jest.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS + 1);
    });
    expect(outcome.settled).toBe(false);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(LONG_WRITE_TIMEOUT_MS);
    });
    expect((outcome.error as { code?: string }).code).toBe("REQUEST_TIMEOUT");
  });

  it("puts no timeout on an imperative GET read", async () => {
    const fetchMock = hangingFetch();
    const { result } = renderMutation({
      method: "GET",
      body: () => undefined,
    });
    let outcome!: ReturnType<typeof start>;
    await act(async () => {
      outcome = start(result.current.mutateAsync, { id: "s1" });
      await jest.advanceTimersByTimeAsync(LONG_WRITE_TIMEOUT_MS * 2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.signal).toBeUndefined();
    expect(outcome.settled).toBe(false);
  });

  it("keeps a caller's own abort distinct from a timeout", async () => {
    hangingFetch();
    const controller = new AbortController();
    const { result } = renderMutation({
      options: { signal: controller.signal },
    });
    let outcome!: ReturnType<typeof start>;
    await act(async () => {
      outcome = start(result.current.mutateAsync, { id: "s1", name: "A" });
      await jest.advanceTimersByTimeAsync(10);
      controller.abort();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(outcome.settled).toBe(true);
    expect((outcome.error as { code?: string }).code).not.toBe(
      "REQUEST_TIMEOUT"
    );
  });

  it("releases a timed-out write so an explicit retry sends again (#751)", async () => {
    const fetchMock = hangingFetch();
    const { result } = renderMutation();
    await act(async () => {
      start(result.current.mutateAsync, { id: "s1", name: "A" });
      await jest.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS);
    });
    await act(async () => {
      start(result.current.mutateAsync, { id: "s1", name: "A" });
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
