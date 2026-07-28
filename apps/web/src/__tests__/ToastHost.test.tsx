import { jest } from "@jest/globals";

import { render, screen, fireEvent } from "./test-utils";
import { ToastHost } from "../components/ToastHost.component";
import { TOAST_ANCHOR } from "../utils/toast.constants";
import type { Toast } from "../utils/toast.context";

// #293 slice 2: pure UI over the queue's output. No state, no timers — the
// provider owns those and hands this component a already-sliced visible set.

const toast = (overrides: Partial<Toast> = {}): Toast => ({
  id: "t-1",
  message: "Saved",
  severity: "success",
  ...overrides,
});

const baseProps = {
  toasts: [toast()],
  hiddenCount: 0,
  onDismiss: jest.fn<(id: string) => void>(),
  onDismissAll: jest.fn<() => void>(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ToastHost — rendering", () => {
  it("renders one alert per toast, tagged by severity", () => {
    render(
      <ToastHost
        {...baseProps}
        toasts={[
          toast({ id: "a", severity: "success", message: "Saved" }),
          toast({ id: "b", severity: "error", message: "Failed" }),
        ]}
      />
    );
    expect(screen.getByTestId("toast-success")).toHaveTextContent("Saved");
    expect(screen.getByTestId("toast-error")).toHaveTextContent("Failed");
  });

  // The case that keeps the mounting slice inert: this host joins the shared
  // test harness, so an always-present node would perturb every existing
  // suite and the 15 existing snapshots.
  it("renders nothing at all when there are no toasts", () => {
    const { container } = render(<ToastHost {...baseProps} toasts={[]} />);
    expect(container.querySelector('[data-testid="toast-host"]')).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Not even an empty positioned container.
    expect(container).toBeEmptyDOMElement();
  });

  it("anchors bottom-right, clear of UpdateBanner's bottom-center", () => {
    render(<ToastHost {...baseProps} />);
    // Asserted through the constant the host must consume.
    expect(TOAST_ANCHOR).toEqual({ vertical: "bottom", horizontal: "right" });
    expect(screen.getByTestId("toast-host")).toBeInTheDocument();
  });
});

describe("ToastHost — dismissal", () => {
  it("calls onDismiss with that toast's id from its close button", () => {
    render(<ToastHost {...baseProps} toasts={[toast({ id: "abc" })]} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(baseProps.onDismiss).toHaveBeenCalledWith("abc");
  });
});

describe("ToastHost — actions", () => {
  it("renders an action label and invokes it", () => {
    const onClick = jest.fn();
    render(
      <ToastHost
        {...baseProps}
        toasts={[toast({ action: { label: "Retry", onClick } })]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("renders no action affordance when none is supplied", () => {
    render(<ToastHost {...baseProps} />);
    expect(
      screen.queryByRole("button", { name: "Retry" })
    ).not.toBeInTheDocument();
  });
});

describe("ToastHost — overflow row", () => {
  it("shows the count and a Dismiss all when toasts are hidden", () => {
    render(<ToastHost {...baseProps} hiddenCount={3} />);
    expect(screen.getByTestId("toast-overflow-count")).toHaveTextContent(
      "+3 more"
    );
    expect(screen.getByTestId("toast-dismiss-all")).toBeInTheDocument();
  });

  it("fires onDismissAll from that button", () => {
    render(<ToastHost {...baseProps} hiddenCount={2} />);
    fireEvent.click(screen.getByTestId("toast-dismiss-all"));
    expect(baseProps.onDismissAll).toHaveBeenCalled();
  });

  it("shows neither the count nor Dismiss all when nothing is hidden", () => {
    render(<ToastHost {...baseProps} hiddenCount={0} />);
    expect(
      screen.queryByTestId("toast-overflow-count")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("toast-dismiss-all")).not.toBeInTheDocument();
  });
});
