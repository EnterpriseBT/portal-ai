import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");
const { ConnectorInstanceSyncFeedbackUI } = await import(
  "../components/ConnectorInstanceSyncFeedback.component"
);

describe("ConnectorInstanceSyncFeedbackUI", () => {
  const baseProps = {
    jobStatus: null,
    progress: 0,
    recordCounts: null,
    errorMessage: null,
    onDismissResult: jest.fn(),
  } as const;

  it("renders nothing when idle and no result/error", () => {
    const { container } = render(
      <ConnectorInstanceSyncFeedbackUI {...baseProps} />
    );

    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    // MUI Snackbar with `open={false}` portals nothing into the document
    // body — a Snackbar whose `open` is true would mount a positioned
    // wrapper there.
    expect(document.querySelector(".MuiSnackbar-root")).toBeNull();
  });

  it("renders the result/error feedback inside a MUI Snackbar (toast, not inline)", () => {
    render(
      <ConnectorInstanceSyncFeedbackUI
        {...baseProps}
        jobStatus="completed"
        recordCounts={{ created: 1, updated: 0, unchanged: 0, deleted: 0 }}
      />
    );
    // Snackbar mounts a positioned root in the document body — the
    // result Alert is its child. Inline-rendered alerts wouldn't carry
    // the .MuiSnackbar-root class.
    expect(document.querySelector(".MuiSnackbar-root")).not.toBeNull();
  });

  it("renders a progress bar while the job is active", () => {
    const { container } = render(
      <ConnectorInstanceSyncFeedbackUI
        {...baseProps}
        jobStatus="active"
        progress={42}
      />
    );

    const progressBar = container.querySelector('[role="progressbar"]');
    expect(progressBar).not.toBeNull();
  });

  it("shows the success summary when the job completes with recordCounts", () => {
    render(
      <ConnectorInstanceSyncFeedbackUI
        {...baseProps}
        jobStatus="completed"
        progress={100}
        recordCounts={{ created: 1, updated: 2, unchanged: 5, deleted: 0 }}
      />
    );

    expect(
      screen.getByText(
        /Sync complete: 1 added, 2 updated, 5 unchanged, 0 removed/
      )
    ).toBeInTheDocument();
  });

  it("shows an error alert when the job fails", () => {
    render(
      <ConnectorInstanceSyncFeedbackUI
        {...baseProps}
        jobStatus="failed"
        progress={50}
        errorMessage="Google API returned 401"
      />
    );

    expect(screen.getByText("Google API returned 401")).toBeInTheDocument();
  });

  it("invokes onDismissResult when the user closes the success alert", () => {
    const onDismissResult = jest.fn();
    render(
      <ConnectorInstanceSyncFeedbackUI
        {...baseProps}
        jobStatus="completed"
        recordCounts={{ created: 0, updated: 0, unchanged: 0, deleted: 0 }}
        onDismissResult={onDismissResult}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onDismissResult).toHaveBeenCalledTimes(1);
  });

  it("hides the progress bar once the job reaches a terminal status", () => {
    const { container } = render(
      <ConnectorInstanceSyncFeedbackUI
        {...baseProps}
        jobStatus="completed"
        recordCounts={{ created: 0, updated: 0, unchanged: 0, deleted: 0 }}
      />
    );

    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("renders an inline Reconnect button when the failure looks auth-related and onReconnect is provided", () => {
    const onReconnect = jest.fn();
    render(
      <ConnectorInstanceSyncFeedbackUI
        {...baseProps}
        jobStatus="failed"
        errorMessage="Google refresh_token rejected (invalid_grant)"
        showReconnect={true}
        onReconnect={onReconnect}
        isReconnecting={false}
      />
    );

    const btn = screen.getByRole("button", { name: /reconnect/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("does NOT render a Reconnect button on a non-auth failure", () => {
    render(
      <ConnectorInstanceSyncFeedbackUI
        {...baseProps}
        jobStatus="failed"
        errorMessage="Google API returned 500"
        showReconnect={false}
        onReconnect={jest.fn()}
      />
    );

    expect(
      screen.queryByRole("button", { name: /reconnect/i })
    ).not.toBeInTheDocument();
  });

  it("disables the inline Reconnect button while reconnecting", () => {
    render(
      <ConnectorInstanceSyncFeedbackUI
        {...baseProps}
        jobStatus="failed"
        errorMessage="invalid_grant"
        showReconnect={true}
        isReconnecting={true}
        onReconnect={jest.fn()}
      />
    );

    expect(
      screen.getByRole("button", { name: /reconnecting/i })
    ).toBeDisabled();
  });
});
