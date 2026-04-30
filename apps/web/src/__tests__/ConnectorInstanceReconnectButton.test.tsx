import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");
const { ConnectorInstanceReconnectButtonUI } = await import(
  "../components/ConnectorInstanceReconnectButton.component"
);

describe("ConnectorInstanceReconnectButtonUI", () => {
  const baseProps = {
    status: "active",
    isReconnecting: false,
    errorMessage: null,
    onReconnect: jest.fn(),
    onDismissError: jest.fn(),
  } as const;

  it("renders nothing when status is not 'error'", () => {
    const { container } = render(
      <ConnectorInstanceReconnectButtonUI {...baseProps} status="active" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the Reconnect button when status is 'error'", () => {
    render(<ConnectorInstanceReconnectButtonUI {...baseProps} status="error" />);
    const btn = screen.getByRole("button", { name: /reconnect/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it("shows Reconnecting… and disables the button while in flight", () => {
    render(
      <ConnectorInstanceReconnectButtonUI
        {...baseProps}
        status="error"
        isReconnecting={true}
      />
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveTextContent(/reconnecting/i);
    expect(btn).toBeDisabled();
  });

  it("invokes onReconnect when the button is clicked", () => {
    const onReconnect = jest.fn();
    render(
      <ConnectorInstanceReconnectButtonUI
        {...baseProps}
        status="error"
        onReconnect={onReconnect}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /reconnect/i }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("renders an error alert when errorMessage is set", () => {
    render(
      <ConnectorInstanceReconnectButtonUI
        {...baseProps}
        status="error"
        errorMessage="Popup blocked"
      />
    );
    expect(screen.getByText("Popup blocked")).toBeInTheDocument();
  });

  it("invokes onDismissError when the user closes the error alert", () => {
    const onDismissError = jest.fn();
    render(
      <ConnectorInstanceReconnectButtonUI
        {...baseProps}
        status="error"
        errorMessage="Popup blocked"
        onDismissError={onDismissError}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });

  it("renders the contained variant when used as the page primary action", () => {
    const { container } = render(
      <ConnectorInstanceReconnectButtonUI
        {...baseProps}
        status="error"
        variant="contained"
      />
    );
    const btn = container.querySelector("button");
    expect(btn?.className ?? "").toMatch(/MuiButton-contained/);
  });
});
