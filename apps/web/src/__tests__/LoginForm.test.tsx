import { jest } from "@jest/globals";
import { render, screen } from "./test-utils";
import userEvent from "@testing-library/user-event";

// Mock sdk to avoid import.meta.env in api.util.ts
jest.mock("../api/sdk", () => ({
  sdk: {
    auth: {
      session: () => ({
        user: undefined,
        isAuthenticated: false,
        isLoading: false,
        error: undefined,
      }),
      login: () => ({ withGoogle: jest.fn() }),
      logout: () => ({ logout: jest.fn() }),
    },
    organizations: {
      current: () => ({ data: undefined }),
    },
  },
  queryKeys: {},
}));

import { LoginFormUI, LoginForm } from "../components/LoginForm.component";

describe("LoginFormUI Component", () => {
  const mockOnClickGoogleLogin = jest.fn();

  beforeEach(() => {
    mockOnClickGoogleLogin.mockClear();
  });

  it("should match snapshot", () => {
    const { container } = render(
      <LoginFormUI onClickGoogleLogin={mockOnClickGoogleLogin} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("should render welcome message", () => {
    render(<LoginFormUI onClickGoogleLogin={mockOnClickGoogleLogin} />);
    expect(screen.getByText("Welcome to Portals AI")).toBeInTheDocument();
  });

  it("should render Google login button", () => {
    render(<LoginFormUI onClickGoogleLogin={mockOnClickGoogleLogin} />);
    expect(
      screen.getByRole("button", { name: /sign in with google/i })
    ).toBeInTheDocument();
  });

  it("should render the terms and privacy consent notice", () => {
    render(<LoginFormUI onClickGoogleLogin={mockOnClickGoogleLogin} />);
    expect(
      screen.getByText(/by continuing, you agree to our/i)
    ).toBeInTheDocument();
  });

  it("should link Terms of Service and Privacy Policy to the marketing site", () => {
    render(<LoginFormUI onClickGoogleLogin={mockOnClickGoogleLogin} />);

    const terms = screen.getByRole("link", { name: /terms of service/i });
    const privacy = screen.getByRole("link", { name: /privacy policy/i });

    // The resolver falls back to the prod origin when VITE_SITE_URL is unset,
    // which is the case in the jest environment (no import.meta.env).
    expect(terms).toHaveAttribute("href", "https://www.portalsai.io/terms/");
    expect(privacy).toHaveAttribute(
      "href",
      "https://www.portalsai.io/privacy/"
    );
    expect(terms).toHaveAttribute("target", "_blank");
    expect(terms).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("should call onClickGoogleLogin when button is clicked", async () => {
    const user = userEvent.setup();
    render(<LoginFormUI onClickGoogleLogin={mockOnClickGoogleLogin} />);

    const button = screen.getByRole("button", { name: /sign in with google/i });
    await user.click(button);

    expect(mockOnClickGoogleLogin).toHaveBeenCalledTimes(1);
  });

  it("case 20 — renders a generic 'Sign in' label when passed one (residency)", () => {
    render(
      <LoginFormUI
        onClickGoogleLogin={mockOnClickGoogleLogin}
        primaryLabel="Sign in"
        showProviderIcon={false}
      />
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /sign in with google/i })
    ).not.toBeInTheDocument();
  });
});

describe("LoginFormUI QA sign-in (#489)", () => {
  it("renders QA sign-in when the container passes a handler, and calls it", async () => {
    const user = userEvent.setup();
    const onClickQaLogin = jest.fn();
    render(
      <LoginFormUI
        onClickGoogleLogin={jest.fn()}
        onClickQaLogin={onClickQaLogin}
      />
    );
    await user.click(screen.getByTestId("e2e-qa-login"));
    expect(onClickQaLogin).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "QA sign-in" })
    ).toBeInTheDocument();
  });

  it("renders no QA sign-in without a handler", () => {
    render(<LoginFormUI onClickGoogleLogin={jest.fn()} />);
    expect(screen.queryByTestId("e2e-qa-login")).not.toBeInTheDocument();
  });

  it("can show the dev and QA affordances together", () => {
    render(
      <LoginFormUI
        onClickGoogleLogin={jest.fn()}
        onClickDevLogin={jest.fn()}
        onClickQaLogin={jest.fn()}
      />
    );
    expect(screen.getByTestId("e2e-dev-login")).toBeInTheDocument();
    expect(screen.getByTestId("e2e-qa-login")).toBeInTheDocument();
  });
});

describe("LoginForm container label (#607)", () => {
  afterEach(() => {
    delete (window as { __RUNTIME_CONFIG__?: unknown }).__RUNTIME_CONFIG__;
  });

  it("case 20 — SaaS (auth0) shows 'Sign in with Google'", () => {
    render(<LoginForm />);
    expect(
      screen.getByRole("button", { name: /sign in with google/i })
    ).toBeInTheDocument();
  });

  it("case 20 — residency (oidc) shows a generic 'Sign in'", () => {
    (
      window as unknown as { __RUNTIME_CONFIG__: Record<string, string> }
    ).__RUNTIME_CONFIG__ = {
      AUTH_PROVIDER: "oidc",
      DEPLOY_MODE: "residency",
      OIDC_ISSUER: "https://id.customer.example",
      OIDC_CLIENT_ID: "portalai-web",
      OIDC_AUDIENCE: "https://api.customer.example",
    };
    render(<LoginForm />);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  // jest has no import.meta.env, i.e. a build without VITE_AUTH0_QA_CONNECTION.
  it("#489 — ?qa alone shows nothing when the build names no QA connection", () => {
    window.history.pushState({}, "", "/login?qa=1");
    render(<LoginForm />);
    expect(screen.queryByTestId("e2e-qa-login")).not.toBeInTheDocument();
    window.history.pushState({}, "", "/");
  });
});
