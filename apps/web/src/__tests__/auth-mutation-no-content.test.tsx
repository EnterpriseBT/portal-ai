/**
 * A write the API answers with `204 No Content` (removing a member) has no
 * body. Reading one as JSON threw "Unexpected end of JSON input", so a
 * removal that succeeded showed as a failure, and a retry then 404'd (#916's
 * smoke).
 */
import { jest } from "@jest/globals";
import React from "react";

const getToken = jest.fn(async (): Promise<string> => "token");
const mockAuthValue = {
  session: {
    user: { sub: "auth0|x" },
    isAuthenticated: true,
    isLoading: false,
    error: undefined as Error | undefined,
  },
  getToken,
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
const { useAuthMutation } = await import("../utils/api.util");

const renderDelete = () => {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useAuthMutation<void, { userId: string }>({
        url: (v) => `/api/organization/members/${v.userId}`,
        method: "DELETE",
        body: () => undefined,
      }),
    { wrapper }
  );
};

describe("useAuthMutation with a 204 response", () => {
  beforeEach(() => jest.clearAllMocks());

  it("resolves undefined instead of failing to parse the empty body", async () => {
    global.fetch = jest.fn<typeof fetch>(
      async () =>
        ({
          ok: true,
          status: 204,
          headers: new Headers(),
          json: async () => {
            throw new SyntaxError(
              "Failed to execute 'json' on 'Response': Unexpected end of JSON input"
            );
          },
        }) as unknown as Response
    );
    const { result } = renderDelete();

    let outcome: unknown = "unset";
    await act(async () => {
      outcome = await result.current.mutateAsync({ userId: "u1" });
    });

    expect(outcome).toBeUndefined();
  });

  it("still unwraps a JSON payload from a 200", async () => {
    global.fetch = jest.fn<typeof fetch>(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ success: true, payload: { removed: true } }),
        }) as unknown as Response
    );
    const { result } = renderDelete();

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.mutateAsync({ userId: "u1" });
    });

    expect(outcome).toEqual({ removed: true });
  });
});
