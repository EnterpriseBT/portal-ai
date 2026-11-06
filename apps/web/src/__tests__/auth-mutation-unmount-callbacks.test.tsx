/**
 * #970: a call's own `onSuccess` / `onError` / `onSettled` run even when the
 * caller unmounts before its request settles. React Query runs per-call
 * callbacks only while the caller's observer is mounted, so browser Back
 * during a pending invite lost its "Invitation created" toast.
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

describe("useAuthMutation per-call callbacks after unmount (#970)", () => {
  it("runs mutate's onSuccess and onSettled after the caller unmounts", async () => {
    const { pending } = deferredFetch();
    const { result, unmount } = renderMutation();
    const onSuccess = jest.fn();
    const onSettled = jest.fn();

    act(() =>
      result.current.mutate({ id: "s1", name: "A" }, { onSuccess, onSettled })
    );
    await flush();
    unmount();
    await act(async () => pending[0].ok({ id: "s1" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess.mock.calls[0]?.slice(0, 2)).toEqual([
      { id: "s1" },
      { id: "s1", name: "A" },
    ]);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("runs mutate's onError and onSettled after the caller unmounts", async () => {
    const { pending } = deferredFetch();
    const { result, unmount } = renderMutation();
    const onError = jest.fn();
    const onSettled = jest.fn();

    act(() =>
      result.current.mutate({ id: "s1", name: "A" }, { onError, onSettled })
    );
    await flush();
    unmount();
    await act(async () => pending[0].fail());

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect((onError.mock.calls[0]?.[0] as { code: string }).code).toBe(
      "STATION_CONFLICT"
    );
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("runs mutateAsync's onSuccess after the caller unmounts", async () => {
    const { pending } = deferredFetch();
    const { result, unmount } = renderMutation();
    const onSuccess = jest.fn();

    let request!: Promise<unknown>;
    act(() => {
      request = result.current.mutateAsync({ id: "s1" }, { onSuccess });
    });
    await flush();
    unmount();
    await act(async () => pending[0].ok({ id: "s1" }));

    await expect(request).resolves.toEqual({ id: "s1" });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("runs the hook-level onSuccess before the per-call one", async () => {
    const { pending } = deferredFetch();
    const order: string[] = [];
    const { result } = renderMutation({
      mutationOptions: { onSuccess: () => void order.push("hook") },
    });

    act(() =>
      result.current.mutate(
        { id: "s1" },
        { onSuccess: () => void order.push("call") }
      )
    );
    await flush();
    await act(async () => pending[0].ok({}));

    await waitFor(() => expect(order).toEqual(["hook", "call"]));
  });

  it("runs each different request's own callbacks, not only the latest's", async () => {
    const { pending } = deferredFetch();
    const { result } = renderMutation();
    const first = jest.fn();
    const second = jest.fn();

    act(() => {
      result.current.mutate({ id: "s1" }, { onSuccess: first });
      result.current.mutate({ id: "s2" }, { onSuccess: second });
    });
    await flush();
    await act(async () => pending.forEach((p) => p.ok({})));

    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    expect(second).toHaveBeenCalledTimes(1);
  });
});
