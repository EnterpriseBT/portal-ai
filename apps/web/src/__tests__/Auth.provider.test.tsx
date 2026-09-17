/**
 * The `useAuth()` seam + Auth0 bridge (#607, slice 2).
 *
 * Mocks the vendor `@auth0/auth0-react` and asserts the bridge maps it onto the
 * normalized `NormalizedAuth` the whole app consumes. The OIDC bridge lands in
 * slice 3; here only the Auth0 (SaaS) path exists.
 */
import { jest } from "@jest/globals";
import React from "react";

const mockGetAccessTokenSilently = jest
  .fn<(opts?: unknown) => Promise<string>>()
  .mockResolvedValue("mock-access-token");
const mockLoginWithRedirect = jest.fn();
const mockLogout = jest.fn();

let mockUseAuth0Value: Record<string, unknown>;

jest.unstable_mockModule("@auth0/auth0-react", () => ({
  Auth0Provider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useAuth0: () => mockUseAuth0Value,
}));

const mockSigninRedirect = jest.fn();
const mockSignoutRedirect = jest.fn();
const mockSigninSilent = jest
  .fn<() => Promise<{ access_token?: string } | null>>()
  .mockResolvedValue(null);

let mockOidcValue: Record<string, unknown>;

jest.unstable_mockModule("react-oidc-context", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useAuth: () => mockOidcValue,
}));

const RESIDENCY_CONFIG = {
  AUTH_PROVIDER: "oidc",
  DEPLOY_MODE: "residency",
  OIDC_ISSUER: "https://id.customer.example",
  OIDC_CLIENT_ID: "portalai-web",
  OIDC_AUDIENCE: "https://api.customer.example",
};

const setRuntimeConfig = (cfg: Record<string, string>) => {
  (
    window as unknown as { __RUNTIME_CONFIG__: Record<string, string> }
  ).__RUNTIME_CONFIG__ = cfg;
};

const { render, screen, fireEvent, waitFor } =
  await import("@testing-library/react");
const { AuthProvider, useAuth } = await import("../providers/Auth.provider");

const Probe: React.FC = () => {
  const auth = useAuth();
  const [token, setToken] = React.useState("");
  return (
    <div>
      <span data-testid="authed">{String(auth.session.isAuthenticated)}</span>
      <span data-testid="loading">{String(auth.session.isLoading)}</span>
      <span data-testid="user">
        {(auth.session.user as { name?: string })?.name ?? ""}
      </span>
      <span data-testid="token">{token}</span>
      <button
        onClick={async () => {
          setToken(await auth.getToken());
        }}
      >
        token
      </button>
      <button onClick={() => auth.login.withGoogle()}>google</button>
      <button onClick={() => auth.login.withUniversal()}>universal</button>
      <button onClick={() => auth.logout()}>logout</button>
    </div>
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAccessTokenSilently.mockResolvedValue("mock-access-token");
  mockSigninSilent.mockResolvedValue(null);
  mockUseAuth0Value = {
    user: { name: "Ada" },
    isAuthenticated: true,
    isLoading: false,
    error: undefined,
    getAccessTokenSilently: mockGetAccessTokenSilently,
    loginWithRedirect: mockLoginWithRedirect,
    logout: mockLogout,
  };
  mockOidcValue = {
    user: { access_token: "oidc-token", profile: { name: "Rey" } },
    isAuthenticated: true,
    isLoading: false,
    error: undefined,
    signinRedirect: mockSigninRedirect,
    signoutRedirect: mockSignoutRedirect,
    signinSilent: mockSigninSilent,
  };
});

afterEach(() => {
  delete (window as { __RUNTIME_CONFIG__?: unknown }).__RUNTIME_CONFIG__;
});

describe("useAuth() seam — Auth0 bridge (#607)", () => {
  it("case 7 — session reflects the mocked useAuth0 values", () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    expect(screen.getByTestId("authed")).toHaveTextContent("true");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("user")).toHaveTextContent("Ada");
  });

  it("case 8 — getToken returns the vendor token with an audience", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    fireEvent.click(screen.getByText("token"));
    await waitFor(() =>
      expect(screen.getByTestId("token")).toHaveTextContent("mock-access-token")
    );
    expect(mockGetAccessTokenSilently).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationParams: expect.objectContaining({
          audience: expect.any(String),
        }),
      })
    );
  });

  it("case 9 — withGoogle pins the google connection; withUniversal does not", () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    fireEvent.click(screen.getByText("google"));
    expect(mockLoginWithRedirect).toHaveBeenLastCalledWith(
      expect.objectContaining({
        authorizationParams: expect.objectContaining({
          connection: "google-oauth2",
        }),
      })
    );

    fireEvent.click(screen.getByText("universal"));
    const calls = mockLoginWithRedirect.mock.calls;
    const lastCall = calls[calls.length - 1]?.[0] as {
      authorizationParams?: { connection?: string };
    };
    expect(lastCall.authorizationParams?.connection).toBeUndefined();
  });

  it("case 10 — logout calls the vendor logout with returnTo origin", () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    fireEvent.click(screen.getByText("logout"));
    expect(mockLogout).toHaveBeenCalledWith(
      expect.objectContaining({
        logoutParams: expect.objectContaining({
          returnTo: window.location.origin,
        }),
      })
    );
  });

  it("case 13 — useAuth outside an AuthProvider throws", () => {
    // Silence React's expected error log for the thrown render.
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(
      "useAuth must be used within an AuthProvider"
    );
    spy.mockRestore();
  });
});

describe("useAuth() seam — OIDC bridge (#607)", () => {
  it("case 11 — session/token map from react-oidc-context; login/logout redirect", async () => {
    setRuntimeConfig(RESIDENCY_CONFIG);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    // case 21 — a protected view renders under the OIDC provider without crashing.
    expect(screen.getByTestId("authed")).toHaveTextContent("true");
    expect(screen.getByTestId("user")).toHaveTextContent("Rey");

    fireEvent.click(screen.getByText("token"));
    await waitFor(() =>
      expect(screen.getByTestId("token")).toHaveTextContent("oidc-token")
    );

    fireEvent.click(screen.getByText("google"));
    fireEvent.click(screen.getByText("universal"));
    expect(mockSigninRedirect).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByText("logout"));
    expect(mockSignoutRedirect).toHaveBeenCalledTimes(1);
  });

  it("case 12 — a blank OIDC field under oidc fails closed (no silent Auth0 fallback)", () => {
    setRuntimeConfig({ ...RESIDENCY_CONFIG, OIDC_ISSUER: "" });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>
      )
    ).toThrow(/OIDC config incomplete/);
    spy.mockRestore();
    // The Auth0 bridge was never mounted.
    expect(mockGetAccessTokenSilently).not.toHaveBeenCalled();
  });
});
