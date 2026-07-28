import React, { useEffect } from "react";
import { jest } from "@jest/globals";

import { render, screen, act, fireEvent } from "./test-utils";
import { ToastProvider } from "../providers/Toast.provider";
import { useToast } from "../utils/toast.context";
import {
  TOAST_AUTO_HIDE_MS,
  TOAST_MAX_VISIBLE,
  TOAST_QUEUE_CAP,
} from "../utils/toast.constants";
import type { ToastApi } from "../utils/toast.context";

// #293 slice 3: the queue. Driven through a probe that captures the API, so
// the assertions exercise the real provider + real host together.
//
// Timers are FAKE throughout and advanced explicitly — never a wall-clock
// wait. This repo already carries several timing-sensitive flakes; a toast
// suite asserting on elapsed real time would be the next one.

/**
 * The probe hands its API out through a callback fired from an effect. It
 * cannot write to a captured object instead: the React Compiler lint rule
 * treats both module-scope variables and props as immutable from inside a
 * component, so the assignment has to happen in the caller's closure.
 */
const Probe: React.FC<{ onApi: (api: ToastApi) => void }> = ({ onApi }) => {
  const toast = useToast();
  useEffect(() => {
    onApi(toast);
  }, [toast, onApi]);
  return null;
};

/** Mounts the provider and returns an accessor for the live API. */
const mount = (): (() => ToastApi) => {
  let current: ToastApi | null = null;
  render(
    <ToastProvider>
      <Probe
        onApi={(next) => {
          current = next;
        }}
      />
    </ToastProvider>
  );
  return () => {
    if (!current) throw new Error("Probe not mounted");
    return current;
  };
};

/** Raise inside `act` — every raise is a state update. */
const raise = (fn: () => void) => act(() => void fn());

/** Advance fake timers inside `act`. */
const advance = (ms: number) => act(() => void jest.advanceTimersByTime(ms));

const alerts = () => screen.queryAllByRole("alert");

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe("ToastProvider — raising (spec cases 1–2)", () => {
  it("renders a raised toast with its message and severity", () => {
    const api = mount();
    raise(() => api().show({ message: "Hello", severity: "info" }));
    expect(screen.getByTestId("toast-info")).toHaveTextContent("Hello");
  });

  it("severity methods delegate to show", () => {
    const api = mount();
    raise(() => api().error("Broke"));
    expect(screen.getByTestId("toast-error")).toHaveTextContent("Broke");
    raise(() => api().success("Fixed"));
    expect(screen.getByTestId("toast-success")).toHaveTextContent("Fixed");
  });

  it("passes an action through to the toast", () => {
    const onClick = jest.fn();
    const api = mount();
    raise(() => api().error("Failed", { action: { label: "Retry", onClick } }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("ToastProvider — bounded stack (spec cases 3–4)", () => {
  it(`renders at most ${TOAST_MAX_VISIBLE} toasts`, () => {
    const api = mount();
    raise(() => {
      api().error("one");
      api().error("two");
      api().error("three");
      api().error("four");
    });
    expect(alerts()).toHaveLength(TOAST_MAX_VISIBLE);
    expect(screen.queryByText("four")).not.toBeInTheDocument();
  });

  it("reports the hidden ones as a count", () => {
    const api = mount();
    raise(() => {
      api().error("one");
      api().error("two");
      api().error("three");
      api().error("four");
    });
    expect(screen.getByTestId("toast-overflow-count")).toHaveTextContent(
      "+1 more"
    );
  });
});

describe("ToastProvider — per-severity timing (spec cases 5–8)", () => {
  it("auto-dismisses a success after its duration", () => {
    const api = mount();
    raise(() => api().success("Saved"));
    advance(TOAST_AUTO_HIDE_MS.success as number);
    expect(screen.queryByTestId("toast-success")).not.toBeInTheDocument();
  });

  it("auto-dismisses info and warning after theirs", () => {
    const api = mount();
    raise(() => api().info("FYI"));
    advance(TOAST_AUTO_HIDE_MS.info as number);
    expect(screen.queryByTestId("toast-info")).not.toBeInTheDocument();

    raise(() => api().warning("Careful"));
    advance(TOAST_AUTO_HIDE_MS.warning as number);
    expect(screen.queryByTestId("toast-warning")).not.toBeInTheDocument();
  });

  it("never auto-dismisses an error", () => {
    const api = mount();
    raise(() => api().error("Stays"));
    // Far past every configured duration.
    advance(60_000);
    expect(screen.getByTestId("toast-error")).toHaveTextContent("Stays");
  });

  it("shows an error and a success together, and the success still fades", () => {
    // The case that killed the strict-queue design: an undismissed error must
    // not hide a success behind it.
    const api = mount();
    raise(() => {
      api().error("Broke");
      api().success("Saved");
    });
    expect(alerts()).toHaveLength(2);

    advance(TOAST_AUTO_HIDE_MS.success as number);
    expect(screen.queryByTestId("toast-success")).not.toBeInTheDocument();
    expect(screen.getByTestId("toast-error")).toBeInTheDocument();
  });

  it("starts a promoted toast's timer when it becomes visible, not when queued", () => {
    // A naive implementation starts every timer at raise time, so the 4th
    // toast would be dropped while it was still invisible.
    const api = mount();
    raise(() => {
      api().error("e1");
      api().error("e2");
      api().error("e3");
      api().success("promoted");
    });

    // The success waits behind three persistent errors, well past its own
    // duration. A naive implementation arms every timer at raise time, so it
    // would be silently dropped from the queue while invisible.
    advance((TOAST_AUTO_HIDE_MS.success as number) * 3);

    // Free exactly one slot so the QUEUED success is promoted.
    fireEvent.click(screen.getAllByRole("button", { name: /close/i })[0]);

    // It must still exist — and now be visible.
    expect(screen.getByText("promoted")).toBeInTheDocument();

    // …with a FULL duration measured from promotion, not from raise.
    advance((TOAST_AUTO_HIDE_MS.success as number) - 100);
    expect(screen.getByText("promoted")).toBeInTheDocument();
    advance(200);
    expect(screen.queryByText("promoted")).not.toBeInTheDocument();
  });
});

describe("ToastProvider — dismissal (spec cases 9–10)", () => {
  it("dismisses one and promotes the next pending toast", () => {
    const api = mount();
    raise(() => {
      api().error("one");
      api().error("two");
      api().error("three");
      api().error("four");
    });
    expect(screen.queryByText("four")).not.toBeInTheDocument();

    // Close the first visible toast.
    fireEvent.click(screen.getAllByRole("button", { name: /close/i })[0]);
    expect(screen.getByText("four")).toBeInTheDocument();
    expect(
      screen.queryByTestId("toast-overflow-count")
    ).not.toBeInTheDocument();
  });

  it("dismissAll clears visible and pending, and the overflow row with them", () => {
    const api = mount();
    raise(() => {
      api().error("one");
      api().error("two");
      api().error("three");
      api().error("four");
      api().error("five");
    });
    expect(screen.getByTestId("toast-overflow-count")).toBeInTheDocument();

    raise(() => api().dismissAll());
    expect(alerts()).toHaveLength(0);
    expect(
      screen.queryByTestId("toast-overflow-count")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("toast-host")).not.toBeInTheDocument();
  });
});

describe("ToastProvider — dedupe (spec case 11)", () => {
  it("drops a duplicate of a currently visible toast", () => {
    const api = mount();
    raise(() => api().error("Same"));
    raise(() => api().error("Same"));
    expect(screen.getAllByText("Same")).toHaveLength(1);
  });

  it("does not dedupe a different message or a different severity", () => {
    const api = mount();
    raise(() => api().error("Same"));
    raise(() => api().error("Different"));
    raise(() => api().warning("Same"));
    expect(alerts()).toHaveLength(3);
  });
});

describe("ToastProvider — queue cap (spec case 12)", () => {
  it("drops the oldest PENDING toast, never a visible one", () => {
    const api = mount();
    raise(() => {
      // Unique messages so dedupe does not interfere.
      for (let i = 0; i < TOAST_QUEUE_CAP + 5; i++) api().error(`e${i}`);
    });
    // The three oldest are visible and must survive.
    expect(screen.getByText("e0")).toBeInTheDocument();
    expect(screen.getByText("e1")).toBeInTheDocument();
    expect(screen.getByText("e2")).toBeInTheDocument();
    // Total retained is capped.
    const hidden = Number(
      (screen.getByTestId("toast-overflow-count").textContent ?? "").replace(
        /\D/g,
        ""
      )
    );
    expect(hidden + TOAST_MAX_VISIBLE).toBe(TOAST_QUEUE_CAP);
  });
});

describe("ToastProvider — ids (spec case 13)", () => {
  it("gives identical content distinct ids so dismissal is unambiguous", () => {
    const api = mount();
    // Same message, different severities — both visible, dedupe not triggered.
    raise(() => {
      api().error("Twin");
      api().warning("Twin");
    });
    expect(alerts()).toHaveLength(2);
    // Dismissing one leaves the other: only possible with distinct ids.
    fireEvent.click(screen.getAllByRole("button", { name: /close/i })[0]);
    expect(alerts()).toHaveLength(1);
  });
});
