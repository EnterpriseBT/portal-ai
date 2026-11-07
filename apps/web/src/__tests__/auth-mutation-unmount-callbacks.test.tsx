/**
 * #970: a call's `toast` and `invalidate` run from the hook, so they still
 * happen when the caller unmounts before the request settles (browser Back
 * during a pending invite lost its "Invitation created" toast). The call's own
 * `onSuccess` / `onError` keep React Query's rule: they run only while the
 * caller is mounted, so page-local work (closing a dialog, `navigate`) never
 * runs on a page the user has left.
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
const { ToastContext } = await import("../utils/toast.context");

const toastApi = {
  success: jest.fn(() => ""),
  info: jest.fn(() => ""),
  warning: jest.fn(() => ""),
  error: jest.fn(() => ""),
  show: jest.fn(() => ""),
  dismiss: jest.fn(),
  dismissAll: jest.fn(),
};

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
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ToastContext.Provider value={toastApi}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ToastContext.Provider>
  );
  const rendered = renderHook(
    () =>
      useAuthMutation<unknown, Vars>({
        url: (v) => `/api/stations/${v.id}`,
        method: "PATCH",
        body: (v) => ({ name: v.name }),
        ...config,
      }),
    { wrapper }
  );
  return { ...rendered, invalidate };
};

/** Lets the hook's async token fetch reach `fetch`. */
const flush = () => act(async () => {});

describe("useAuthMutation toast and invalidate after unmount (#970)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("raises the success toast and invalidates after the caller unmounts, but skips onSuccess", async () => {
    const { pending } = deferredFetch();
    const { result, unmount, invalidate } = renderMutation();
    const onSuccess = jest.fn();

    act(() =>
      result.current.mutate(
        { id: "s1", name: "A" },
        {
          onSuccess,
          invalidate: [["invitations"]],
          toast: { success: "Invitation created" },
        }
      )
    );
    await flush();
    unmount();
    await act(async () => pending[0].ok({ id: "s1" }));

    await waitFor(() =>
      expect(toastApi.success).toHaveBeenCalledWith("Invitation created")
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["invitations"] });
    // Page-local work never runs on a page the user has left.
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("raises the error toast through serverErrorMessage after the caller unmounts", async () => {
    const { pending } = deferredFetch();
    const { result, unmount, invalidate } = renderMutation();

    act(() =>
      result.current.mutate(
        { id: "s1" },
        { invalidate: [["stations"]], toast: { error: "Failed to save" } }
      )
    );
    await flush();
    unmount();
    await act(async () => pending[0].fail());

    await waitFor(() =>
      expect(toastApi.error).toHaveBeenCalledWith("Conflict")
    );
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("builds messages from functions, and raises an info toast when asked", async () => {
    const { pending } = deferredFetch();
    const { result } = renderMutation();

    act(() =>
      result.current.mutate(
        { id: "s1" },
        {
          toast: {
            success: (data, vars) =>
              `${(data as { n: number }).n} for ${vars.id}`,
            successSeverity: "info",
          },
        }
      )
    );
    await flush();
    await act(async () => pending[0].ok({ n: 3 }));

    await waitFor(() => expect(toastApi.info).toHaveBeenCalledWith("3 for s1"));
    expect(toastApi.success).not.toHaveBeenCalled();
  });

  it("still runs onSuccess while mounted, alongside the toast", async () => {
    const { pending } = deferredFetch();
    const { result } = renderMutation();
    const onSuccess = jest.fn();

    act(() =>
      result.current.mutate(
        { id: "s1" },
        { onSuccess, toast: { success: "Saved" } }
      )
    );
    await flush();
    await act(async () => pending[0].ok({}));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(toastApi.success).toHaveBeenCalledWith("Saved");
  });

  it("mutateAsync reports the same way and still resolves", async () => {
    const { pending } = deferredFetch();
    const { result, unmount } = renderMutation();

    let request!: Promise<unknown>;
    act(() => {
      request = result.current.mutateAsync(
        { id: "s1" },
        { toast: { success: "Done" } }
      );
    });
    await flush();
    unmount();
    await act(async () => pending[0].ok({ id: "s1" }));

    await expect(request).resolves.toEqual({ id: "s1" });
    await waitFor(() => expect(toastApi.success).toHaveBeenCalledWith("Done"));
  });

  it("a deduped duplicate raises no second toast", async () => {
    const { pending } = deferredFetch();
    const { result } = renderMutation();

    act(() => {
      result.current.mutate(
        { id: "s1", name: "A" },
        { toast: { success: "Once" } }
      );
      result.current.mutate(
        { id: "s1", name: "A" },
        { toast: { success: "Once" } }
      );
    });
    await flush();
    await act(async () => pending[0].ok({}));

    await waitFor(() => expect(toastApi.success).toHaveBeenCalledTimes(1));
  });
});
