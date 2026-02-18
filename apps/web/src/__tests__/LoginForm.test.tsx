import { jest } from "@jest/globals";
import { render, screen } from "./test-utils";
import userEvent from "@testing-library/user-event";
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
    expect(screen.getByText("Sign in to continue")).toBeInTheDocument();
  });

  it("should render Google login button", () => {
    render(<LoginFormUI onClickGoogleLogin={mockOnClickGoogleLogin} />);
    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
  });

  it("should render terms and privacy notice", () => {
    render(<LoginFormUI onClickGoogleLogin={mockOnClickGoogleLogin} />);
    expect(
      screen.getByText(/by continuing, you agree to our terms/i),
    ).toBeInTheDocument();
  });

  it("should call onClickGoogleLogin when button is clicked", async () => {
    const user = userEvent.setup();
    render(<LoginFormUI onClickGoogleLogin={mockOnClickGoogleLogin} />);

    const button = screen.getByRole("button", { name: /continue with google/i });
    await user.click(button);

    expect(mockOnClickGoogleLogin).toHaveBeenCalledTimes(1);
  });
});
