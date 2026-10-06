import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");
const { ConnectorInstanceSyncButtonUI } =
  await import("../components/ConnectorInstanceSyncButton.component");

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

  it("disables the button when not sync-eligible", () => {
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
    render(<ConnectorInstanceSyncButtonUI {...baseProps} jobStatus="active" />);

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

  it("stays enabled when identityWarnings are present (advisory, not blocking)", () => {
    render(
      <ConnectorInstanceSyncButtonUI
        {...baseProps}
        identityWarnings={[{ regionId: "r1" }]}
      />
    );
    const btn = screen.getByRole("button", { name: /sync now/i });
    expect(btn).not.toBeDisabled();
  });

  it("surfaces an advisory tooltip when identityWarnings are present", async () => {
    render(
      <ConnectorInstanceSyncButtonUI
        {...baseProps}
        identityWarnings={[{ regionId: "r1" }, { regionId: "r2" }]}
      />
    );
    const btn = screen.getByRole("button", { name: /sync now/i });
    fireEvent.mouseOver(btn);
    // Tooltip portals into the document, not into the button container.
    expect(
      await screen.findByText(/recreates all records/i)
    ).toBeInTheDocument();
  });

  it("renders nothing for a hide gate (no write on the instance)", () => {
    const { container } = render(
      <ConnectorInstanceSyncButtonUI {...baseProps} gate={{ kind: "hide" }} />
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders a disable gate as aria-disabled, focusable, naming the reason", async () => {
    const onSync = jest.fn();
    const reason =
      "Import is running on this connector — try again when it finishes.";
    render(
      <ConnectorInstanceSyncButtonUI
        {...baseProps}
        onSync={onSync}
        gate={{ kind: "disable", reason }}
      />
    );
    const btn = screen.getByRole("button", { name: /sync now/i });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onSync).not.toHaveBeenCalled();
    fireEvent.mouseOver(btn);
    expect(await screen.findByText(reason)).toBeInTheDocument();
  });

  // #689 (code review): the caller's own sync is also the job that locks the
  // connector. The button keeps saying "Syncing…" rather than "Sync now".
  it("keeps the Syncing… label while its own sync holds the lock", () => {
    render(
      <ConnectorInstanceSyncButtonUI
        {...baseProps}
        jobStatus="active"
        gate={{
          kind: "disable",
          reason:
            "Sync is running on this connector — try again when it finishes.",
        }}
      />
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveTextContent(/syncing/i);
    expect(btn).toBeDisabled();
  });

  it("still hides for a hide gate while a sync runs", () => {
    const { container } = render(
      <ConnectorInstanceSyncButtonUI
        {...baseProps}
        jobStatus="active"
        gate={{ kind: "hide" }}
      />
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("does not render the advisory tooltip when identityWarnings is empty", () => {
    render(
      <ConnectorInstanceSyncButtonUI {...baseProps} identityWarnings={[]} />
    );
    const btn = screen.getByRole("button", { name: /sync now/i });
    fireEvent.mouseOver(btn);
    expect(screen.queryByText(/recreates all records/i)).toBeNull();
  });
});
