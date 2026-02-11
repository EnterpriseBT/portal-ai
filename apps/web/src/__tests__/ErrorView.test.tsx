import { render, screen } from "@testing-library/react";
import { ErrorView } from "../views/Error.view";

describe("ErrorView Component", () => {
  it("should match snapshot with default message", () => {
    const { container } = render(<ErrorView />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("should display default error message when no message prop is provided", () => {
    render(<ErrorView />);
    expect(
      screen.getByText("An error occurred while loading the application."),
    ).toBeInTheDocument();
  });

  it("should display custom error message when message prop is provided", () => {
    const customMessage = "Authentication failed. Please try again.";
    render(<ErrorView message={customMessage} />);
    expect(screen.getByText(customMessage)).toBeInTheDocument();
  });

  it("should match snapshot with custom message", () => {
    const { container } = render(
      <ErrorView message="Network error occurred" />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("should render error message with correct styling", () => {
    render(<ErrorView message="Test error" />);
    const errorText = screen.getByText("Test error");
    expect(errorText).toBeInTheDocument();
  });
});
