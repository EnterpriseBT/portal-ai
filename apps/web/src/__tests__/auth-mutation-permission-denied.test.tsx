/**
 * #688: `useAuthMutation`'s `onPermissionDenied`. A 403 means the caller's
 * capabilities changed under them, so the declared keys are invalidated and
 * the affordances re-render from fresh payloads. Feedback stays the caller's.
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
const { useAuthMutation } = await import("../utils/api.util");

const respond = (status: number, body: unknown) => {
  global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
  } as Response);
};

const setup = () => {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const onError = jest.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () =>
      useAuthMutation<unknown, { id: string }>({
        url: (v) => `/api/curated-views/${v.id}`,
        method: "DELETE",
        body: () => undefined,
        onPermissionDenied: {
          invalidate: (v) => [["curatedViews"], ["curatedViews", v.id]],
        },
        mutationOptions: { onError },
      }),
    { wrapper }
  );
  return { result, invalidate, onError };
};

describe("useAuthMutation onPermissionDenied (#688)", () => {
  it("invalidates the declared keys on a permission denial", async () => {
    respond(403, {
      success: false,
      message: "Insufficient role",
      code: "INSUFFICIENT_ROLE",
    });
    const { result, invalidate } = setup();
    result.current.mutate({ id: "cv-1" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["curatedViews"] });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["curatedViews", "cv-1"],
    });
  });

  it("still calls the caller's onError, so feedback stays with the caller", async () => {
    respond(403, {
      success: false,
      message: "Insufficient role",
      code: "INSUFFICIENT_ROLE",
    });
    const { result, onError } = setup();
    result.current.mutate({ id: "cv-1" });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect((onError.mock.calls[0][0] as { code: string }).code).toBe(
      "INSUFFICIENT_ROLE"
    );
  });

  it("doesn't invalidate on any other error", async () => {
    respond(409, {
      success: false,
      message: "Locked",
      code: "ENTITY_LOCKED_BY_JOB",
    });
    const { result, invalidate, onError } = setup();
    result.current.mutate({ id: "cv-1" });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
