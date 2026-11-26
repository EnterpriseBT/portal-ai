/**
 * #1076: a query that declares `meta: { abortable: true }` always hands its
 * fetch react-query's signal, so a superseded search is aborted. Any other
 * query gets no signal outside a read pause (#747).
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
const { useAuthQuery } = await import("../utils/api.util");
const { resetApiReadPause } = await import("../utils/rate-limit.util");

const ok = () =>
  ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ success: true, payload: "ok" }),
  }) as Response;

const render = (meta?: Record<string, unknown>) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => useAuthQuery<string>(["probe"], "/api/probe", undefined, { meta }),
    { wrapper }
  );
};

const lastInit = (fetchMock: jest.Mock<typeof fetch>) =>
  fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1] as RequestInit;

beforeEach(() => resetApiReadPause());

describe("useAuthQuery abortable reads (#1076)", () => {
  it("passes the signal to a query whose meta is abortable", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(ok());
    global.fetch = fetchMock;
    const { result } = render({ abortable: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastInit(fetchMock).signal).toBeInstanceOf(AbortSignal);
  });

  it("passes no signal to any other query", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(ok());
    global.fetch = fetchMock;
    const { result } = render();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastInit(fetchMock).signal).toBeUndefined();
  });
});
