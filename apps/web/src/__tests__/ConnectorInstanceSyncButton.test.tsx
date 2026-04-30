import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");
const { ConnectorInstanceSyncButtonUI } = await import(
  "../components/ConnectorInstanceSyncButton.component"
);

describe("ConnectorInstanceSyncButtonUI", () => {
  const baseProps = {
    syncEligible: true,
    isStarting: false,
    jobStatus: null,
    onSync: jest.fn(),
  } as const;

  it("renders an enabled Sync now button when sync-eligible and idle", () => {
    render(<ConnectorInstanceSyncButtonUI {...baseProps} />);

    const btn = screen.getByRole("button", { name: /sync now/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it("disables the button and surfaces a tooltip when not sync-eligible", () => {
    render(
      <ConnectorInstanceSyncButtonUI {...baseProps} syncEligible={false} />
    );

    const btn = screen.getByRole("button", { name: /sync now/i });
    expect(btn).toBeDisabled();
  });

  it("shows the Syncing… label and disables the button while the POST is in flight", () => {
    render(<ConnectorInstanceSyncButtonUI {...baseProps} isStarting={true} />);

    const btn = screen.getByRole("button");
    expect(btn).toHaveTextContent(/syncing/i);
    expect(btn).toBeDisabled();
  });

  it("shows Syncing… and disables the button while the job is active", () => {
    render(
      <ConnectorInstanceSyncButtonUI {...baseProps} jobStatus="active" />
    );

    const btn = screen.getByRole("button");
    expect(btn).toHaveTextContent(/syncing/i);
    expect(btn).toBeDisabled();
  });

  it("returns to the Sync now label once the job reaches a terminal status", () => {
    render(
      <ConnectorInstanceSyncButtonUI {...baseProps} jobStatus="completed" />
    );

    const btn = screen.getByRole("button", { name: /sync now/i });
    expect(btn).not.toBeDisabled();
  });

  it("invokes onSync when the button is clicked", () => {
    const onSync = jest.fn();
    render(<ConnectorInstanceSyncButtonUI {...baseProps} onSync={onSync} />);

    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it("renders the contained variant when used as the page primary action", () => {
    const { container } = render(
      <ConnectorInstanceSyncButtonUI {...baseProps} variant="contained" />
    );

    const btn = container.querySelector("button");
    expect(btn?.className ?? "").toMatch(/MuiButton-contained/);
  });
});
