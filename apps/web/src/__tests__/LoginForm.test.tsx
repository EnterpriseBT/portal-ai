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

import { LoginFormUI } from "../components/LoginForm.component";

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
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });

  it("should render Google login button", () => {
    render(<LoginFormUI onClickGoogleLogin={mockOnClickGoogleLogin} />);
    expect(
      screen.getByRole("button", { name: /sign in with google/i })
    ).toBeInTheDocument();
  });

  it("should render terms and privacy notice", () => {
    render(<LoginFormUI onClickGoogleLogin={mockOnClickGoogleLogin} />);
    expect(
      screen.getByText(/by continuing, you agree to our terms/i)
    ).toBeInTheDocument();
  });

  it("should call onClickGoogleLogin when button is clicked", async () => {
    const user = userEvent.setup();
    render(<LoginFormUI onClickGoogleLogin={mockOnClickGoogleLogin} />);

    const button = screen.getByRole("button", { name: /sign in with google/i });
    await user.click(button);

    expect(mockOnClickGoogleLogin).toHaveBeenCalledTimes(1);
  });
});
