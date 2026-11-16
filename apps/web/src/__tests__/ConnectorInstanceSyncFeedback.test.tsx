import { jest } from "@jest/globals";

const { render, screen, fireEvent, expectNoAxeViolations } =
  await import("./test-utils");
const { ConnectorInstanceSyncFeedbackUI } =
  await import("../components/ConnectorInstanceSyncFeedback.component");

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

  // --- structured progress (#458) ---

  it("shows 'X of Y records' with a determinate bar when a total is known", () => {
    const { container } = render(
      <ConnectorInstanceSyncFeedbackUI
        {...baseProps}
        jobStatus="active"
        progress={0}
        progressDetail={{ processed: 123954, total: 397960 }}
      />
    );

    expect(screen.getByText("123,954 of 397,960 records")).toBeInTheDocument();
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).toHaveAttribute("aria-valuenow", "31");
  });

  it("shows a count with an indeterminate bar when the total is unknown — no percent anywhere", () => {
    const { container } = render(
      <ConnectorInstanceSyncFeedbackUI
        {...baseProps}
        jobStatus="active"
        progress={0}
        progressDetail={{ processed: 123954, total: null }}
      />
    );

    expect(screen.getByText("123,954 records so far")).toBeInTheDocument();
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("renders the live bar in inherit color so it contrasts with the filled Alert (#458)", () => {
    const { container } = render(
      <ConnectorInstanceSyncFeedbackUI
        {...baseProps}
        jobStatus="active"
        progress={0}
        progressDetail={{ processed: 100, total: 400 }}
      />
    );

    // The toast is a filled `info` Alert; a primary-palette bar and a
    // text.secondary label are both near-invisible on it. Inherit takes the
    // Alert's own contrast color (white) for the bar, track, and label.
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.className).toContain("MuiLinearProgress-colorInherit");
  });

  it("falls back to the plain percent bar when no detail is reported", () => {
    const { container } = render(
      <ConnectorInstanceSyncFeedbackUI
        {...baseProps}
        jobStatus="active"
        progress={42}
        progressDetail={null}
      />
    );

    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).toHaveAttribute("aria-valuenow", "42");
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

  it("has no axe violations while active", async () => {
    const { container } = render(
      <ConnectorInstanceSyncFeedbackUI
        {...baseProps}
        jobStatus="active"
        progress={0}
        progressDetail={{ processed: 123954, total: 397960 }}
      />
    );
    await expectNoAxeViolations(container);
  });

  it("has no axe violations showing a completed result (portalled Snackbar)", async () => {
    render(
      <ConnectorInstanceSyncFeedbackUI
        {...baseProps}
        jobStatus="completed"
        recordCounts={{ created: 1, updated: 0, unchanged: 0, deleted: 0 }}
      />
    );
    await expectNoAxeViolations(document.body);
  });
});

// #1009: a sync that read past a sheet, or skipped a missing one, completes
// as a warning naming the regions, with a link for whoever can edit the plan.
describe("ConnectorInstanceSyncFeedbackUI — replay warnings", () => {
  const props = {
    jobStatus: "completed" as const,
    progress: 100,
    recordCounts: { created: 1, updated: 0, unchanged: 2, deleted: 3 },
    errorMessage: null,
    onDismissResult: jest.fn(),
  };
  const missing = (i: number) => ({
    kind: "sheet-missing" as const,
    regionId: `r${i}`,
    sheet: `S${i}`,
    targetEntityDefinitionId: "contacts",
    bounds: { startRow: 2, startCol: 2, endRow: 40, endCol: 6 },
    recordsAxis: "row" as const,
  });

  it("renders a warning naming each region, and the tally", () => {
    render(
      <ConnectorInstanceSyncFeedbackUI
        {...props}
        replayWarnings={[missing(1)]}
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert.className).toMatch(/Warning/);
    expect(alert).toHaveTextContent(
      "Synced, but part of the layout plan no longer fits the source"
    );
    expect(alert).toHaveTextContent(
      'was on sheet "S1", which is no longer in the workbook'
    );
    expect(alert).toHaveTextContent(
      "1 added, 0 updated, 2 unchanged, 3 removed"
    );
  });

  it("names three regions, then counts the rest including the omitted ones", () => {
    render(
      <ConnectorInstanceSyncFeedbackUI
        {...props}
        replayWarnings={[missing(1), missing(2), missing(3), missing(4)]}
        replayWarningsOmitted={2}
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent('"S3"');
    expect(alert).not.toHaveTextContent('"S4"');
    expect(alert).toHaveTextContent("+3 more");
  });

  it("links to the layout editor only when given the instance to edit", () => {
    const { unmount } = render(
      <ConnectorInstanceSyncFeedbackUI
        {...props}
        replayWarnings={[missing(1)]}
        editLayoutPlanLink={{ connectorInstanceId: "ci-1" }}
      />
    );
    expect(
      screen.getByRole("link", { name: "Modify layout plan" })
    ).toHaveAttribute("href", "/connectors/ci-1/layout-plan/edit");
    unmount();
    render(
      <ConnectorInstanceSyncFeedbackUI
        {...props}
        replayWarnings={[missing(1)]}
      />
    );
    expect(
      screen.queryByRole("link", { name: "Modify layout plan" })
    ).toBeNull();
  });

  it("renders a sheet name carrying markup as text, never as markup", () => {
    render(
      <ConnectorInstanceSyncFeedbackUI
        {...props}
        replayWarnings={[
          { ...missing(1), sheet: "<img src=x onerror=alert(1)>" },
        ]}
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      'was on sheet "<img src=x onerror=alert(1)>", which is no longer in the workbook'
    );
    expect(alert.querySelector("img")).toBeNull();
  });

  it("renders today's success when there are no warnings", () => {
    render(
      <ConnectorInstanceSyncFeedbackUI {...props} replayWarnings={null} />
    );
    const alert = screen.getByRole("alert");
    expect(alert.className).toMatch(/Success/);
    expect(alert).toHaveTextContent("Sync complete: 1 added");
  });
});
