/**
 * #916: `usePublicMutation` is the only way to call an anonymous
 * `/api/public` route. A signed-out caller has no token, so it must send none
 * and must never treat the missing session as an auth error (which would
 * log the user out mid-sign-in).
 */
import { jest } from "@jest/globals";
import React from "react";

const getToken = jest.fn(async (): Promise<string> => {
  throw new Error("Login required");
});
const mockAuthValue = {
  session: {
    user: undefined,
    isAuthenticated: false,
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
const handleAuthError = jest.fn();
jest.unstable_mockModule("../utils/auth-error.util", () => ({
  handleAuthError,
  registerAuthLogout: jest.fn(),
  SSO_PROVISIONING_NOT_INVITED: "SSO_PROVISIONING_NOT_INVITED",
  handleNotInvited: jest.fn(),
  registerNotInvitedHandler: jest.fn(),
}));

const { renderHook, act } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { usePublicMutation, ApiError } = await import("../utils/api.util");

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  }) as Response;

const renderPublic = () => {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      usePublicMutation<{ connection: string | null }, { email: string }>({
        url: "/api/public/sso-discovery",
      }),
    { wrapper }
  );
};

describe("usePublicMutation (#916)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sends no Authorization header, asks for no token, and unwraps the payload", async () => {
    const fetchMock = jest.fn<typeof fetch>(async () =>
      jsonResponse(200, { success: true, payload: { connection: "acme" } })
    );
    global.fetch = fetchMock;
    const { result } = renderPublic();

    let data: { connection: string | null } | undefined;
    await act(async () => {
      data = await result.current.mutateAsync({ email: "jo@acme.com" });
    });

    expect(data).toEqual({ connection: "acme" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ email: "jo@acme.com" }));
    expect(
      (init.headers as Record<string, string>).Authorization
    ).toBeUndefined();
    expect(getToken).not.toHaveBeenCalled();
  });

  it("maps an error body to ApiError without calling handleAuthError", async () => {
    global.fetch = jest.fn<typeof fetch>(async () =>
      jsonResponse(429, {
        success: false,
        message: "Too many requests.",
        code: "SSO_DISCOVERY_RATE_LIMITED",
      })
    );
    const { result } = renderPublic();

    let caught: unknown;
    await act(async () => {
      caught = await result.current
        .mutateAsync({ email: "jo@acme.com" })
        .catch((e: unknown) => e);
    });

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as InstanceType<typeof ApiError>).code).toBe(
      "SSO_DISCOVERY_RATE_LIMITED"
    );
    expect(handleAuthError).not.toHaveBeenCalled();
  });
});
