/**
 * Consumer wiring over the `useAuth()` seam (#607, slice 2).
 *
 * Mocks the seam (`../providers/Auth.provider`) and asserts each migrated
 * consumer — `useAuthFetch`, `sse.create`, `sdk.auth`, and the app-level 401
 * logout registration — routes through it. A source guard asserts no consumer
 * imports the vendor SDK directly.
 */
import { jest } from "@jest/globals";
import React from "react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const mockGetToken = jest.fn<() => Promise<string>>();
const mockLogout = jest.fn();
const mockWithGoogle = jest.fn();
const mockWithUniversal = jest.fn();

const mockAuthValue = {
  session: {
    user: { name: "Ada" },
    isAuthenticated: true,
    isLoading: false,
    error: undefined as Error | undefined,
  },
  getToken: mockGetToken,
  login: { withGoogle: mockWithGoogle, withUniversal: mockWithUniversal },
  logout: mockLogout,
};

const mockHandleAuthError = jest.fn();
const mockRegisterAuthLogout = jest.fn();

jest.unstable_mockModule("../providers/Auth.provider", () => ({
  useAuth: () => mockAuthValue,
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  AuthContext: React.createContext(mockAuthValue),
}));

jest.unstable_mockModule("../utils/auth-error.util", () => ({
  handleAuthError: mockHandleAuthError,
  registerAuthLogout: mockRegisterAuthLogout,
}));

const { render, renderHook, waitFor } = await import("@testing-library/react");
const { useAuthFetch } = await import("../utils/api.util");
const { sse } = await import("../api/sse.api");
const { auth } = await import("../api/auth.api");

beforeEach(() => {
  jest.clearAllMocks();
  mockGetToken.mockResolvedValue("test-token");
});

describe("useAuthFetch over the seam (#607)", () => {
  it("case 14 — attaches Bearer <getToken()> to the request", async () => {
    const fetchSpy = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: 1 }),
    } as Response);
    global.fetch = fetchSpy as typeof fetch;

    const { result } = renderHook(() => useAuthFetch());
    await result.current.fetchWithAuth("/api/thing");

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/thing"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      })
    );
  });

  it("case 14 — a getToken rejection triggers handleAuthError and rethrows", async () => {
    mockGetToken.mockRejectedValue(new Error("no token"));
    const { result } = renderHook(() => useAuthFetch());

    await expect(result.current.fetchWithAuth("/api/thing")).rejects.toThrow(
      "no token"
    );
    expect(mockHandleAuthError).toHaveBeenCalledTimes(1);
  });
});

describe("sse.create over the seam (#607)", () => {
  it("case 15 — builds a ?token= URL from getToken and opens an EventSource", async () => {
    const eventSourceSpy = jest.fn();
    global.EventSource = eventSourceSpy as unknown as typeof EventSource;

    const { result } = renderHook(() => sse.create());
    await result.current("/api/sse/jobs/1/events");

    expect(eventSourceSpy).toHaveBeenCalledWith(
      expect.stringContaining("token=test-token")
    );
  });
});

describe("sdk.auth surface parity (#607)", () => {
  it("case 18 — session() keeps its shape", () => {
    expect(auth.session()).toEqual(
      expect.objectContaining({
        user: expect.anything(),
        isAuthenticated: true,
        isLoading: false,
      })
    );
  });

  it("case 19 — login() exposes withGoogle/withUniversal and logout() exposes logout", () => {
    const login = auth.login();
    expect(typeof login.withGoogle).toBe("function");
    expect(typeof login.withUniversal).toBe("function");

    const { logout } = auth.logout();
    logout();
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});

describe("Application.provider 401 logout registration (#607)", () => {
  it("case 16 — registers a logout that invokes the seam's logout", async () => {
    const { ApplicationProvider } =
      await import("../providers/Application.provider");
    render(
      <ApplicationProvider>
        <div>child</div>
      </ApplicationProvider>
    );

    await waitFor(() => expect(mockRegisterAuthLogout).toHaveBeenCalled());
    const calls = mockRegisterAuthLogout.mock.calls;
    const registered = calls[calls.length - 1]?.[0] as () => void;
    registered();
    expect(mockLogout).toHaveBeenCalled();
  });
});

describe("no consumer imports the vendor auth SDK directly (#607)", () => {
  it("case 17 / grep guard — @auth0/auth0-react is imported only by Auth.provider", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const srcRoot = path.resolve(here, "..");

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__" || entry.name === "stories") continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (full.endsWith(path.join("providers", "Auth.provider.tsx")))
          continue;
        const text = fs.readFileSync(full, "utf8");
        if (text.includes("@auth0/auth0-react") || /\buseAuth0\b/.test(text)) {
          offenders.push(path.relative(srcRoot, full));
        }
      }
    };
    walk(srcRoot);

    expect(offenders).toEqual([]);
  });
});
