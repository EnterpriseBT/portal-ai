import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");
const { BulkJobProgressBlockUI } = await import(
  "../components/BulkJobProgressBlock.component"
);

type State = {
  status: "running" | "completed" | "failed" | "cancelled";
  recordsProcessed: number;
  totalRecords: number;
  failureCount: number;
  batchDurationMsAvg: number | null;
  batchCount: number;
};

function makeState(overrides: Partial<State> = {}): State {
  return {
    status: "running",
    recordsProcessed: 0,
    totalRecords: 100,
    failureCount: 0,
    batchDurationMsAvg: null,
    batchCount: 0,
    ...overrides,
  };
}

describe("BulkJobProgressBlockUI", () => {
  it("renders counter and progress while running", () => {
    render(
      <BulkJobProgressBlockUI
        state={makeState({ recordsProcessed: 47, totalRecords: 100 })}
        cancelling={false}
        onCancel={() => {}}
      />
    );

    expect(screen.getByText(/47 \/ 100 records/)).toBeInTheDocument();
    expect(screen.getByText(/Running/)).toBeInTheDocument();
  });

  it("renders Completed chip on terminal completed", () => {
    render(
      <BulkJobProgressBlockUI
        state={makeState({
          status: "completed",
          recordsProcessed: 100,
          totalRecords: 100,
        })}
        cancelling={false}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText(/Completed/)).toBeInTheDocument();
    // Cancel button hidden on terminal.
    expect(screen.queryByLabelText("Cancel bulk job")).toBeNull();
  });

  it("renders failed-count alongside counter when failures > 0", () => {
    render(
      <BulkJobProgressBlockUI
        state={makeState({
          recordsProcessed: 47,
          failureCount: 3,
        })}
        cancelling={false}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText(/3 failed/)).toBeInTheDocument();
  });

  it("calls onCancel when the Cancel button is clicked", () => {
    const onCancel = jest.fn();
    render(
      <BulkJobProgressBlockUI
        state={makeState({ recordsProcessed: 47 })}
        cancelling={false}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByLabelText("Cancel bulk job"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables Cancel and shows 'Cancelling…' when cancelling is true", () => {
    render(
      <BulkJobProgressBlockUI
        state={makeState({ recordsProcessed: 47 })}
        cancelling
        onCancel={() => {}}
      />
    );
    const btn = screen.getByLabelText("Cancel bulk job");
    expect(btn).toBeDisabled();
    expect(btn.textContent).toContain("Cancelling");
  });

  it("renders Cancelled chip with the partial count when cancelled", () => {
    render(
      <BulkJobProgressBlockUI
        state={makeState({
          status: "cancelled",
          recordsProcessed: 47,
          totalRecords: 100,
        })}
        cancelling={false}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText(/Cancelled/)).toBeInTheDocument();
    expect(screen.getByText(/47 \/ 100 records/)).toBeInTheDocument();
  });
});
