/**
 * #688: `useAuthMutation`'s `onPermissionDenied`. A 403 means the caller's
 * capabilities changed under them, and a 404 (#713) that the object is gone
 * for them, so the declared keys are invalidated and the affordances
 * re-render from fresh payloads. Feedback stays the caller's.
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
      message: "You don't have permission to edit this view.",
      code: "PERMISSION_DENIED",
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
      message: "You don't have permission to edit this view.",
      code: "PERMISSION_DENIED",
    });
    const { result, onError } = setup();
    result.current.mutate({ id: "cv-1" });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect((onError.mock.calls[0][0] as { code: string }).code).toBe(
      "PERMISSION_DENIED"
    );
  });

  // #711 (spec case 16): the pre-#711 codes are gone; only PERMISSION_DENIED
  // is a denial.
  it("doesn't treat a retired role-named code as a denial", async () => {
    respond(403, {
      success: false,
      message: "Your role does not permit this action",
      code: "INSUFFICIENT_ROLE",
    });
    const { result, invalidate, onError } = setup();
    result.current.mutate({ id: "cv-1" });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(invalidate).not.toHaveBeenCalled();
  });

  // #713: an object the caller can no longer read answers 404 on every verb,
  // so a refused write on it (a share revoked under an open page) must still
  // re-fetch, or the page keeps offering the action.
  it("invalidates on a 404: the object is gone for this caller", async () => {
    respond(404, {
      success: false,
      message: "Curated view not found",
      code: "CURATED_VIEW_NOT_FOUND",
    });
    const { result, invalidate, onError } = setup();
    result.current.mutate({ id: "cv-1" });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["curatedViews"] });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["curatedViews", "cv-1"],
    });
  });

  it("doesn't invalidate on a server error", async () => {
    respond(500, {
      success: false,
      message: "Something went wrong",
      code: "INTERNAL_ERROR",
    });
    const { result, invalidate, onError } = setup();
    result.current.mutate({ id: "cv-1" });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(invalidate).not.toHaveBeenCalled();
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
