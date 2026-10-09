/**
 * #747: one notice per rate-limit window, naming the wait — not one per
 * refused read.
 */
import { jest } from "@jest/globals";
import React from "react";
import { renderHook } from "@testing-library/react";

import { ToastContext } from "../utils/toast.context";
import { useRateLimitNotice } from "../utils/use-rate-limit-notice.util";
import { pauseApiReads, resetApiReadPause } from "../utils/rate-limit.util";

import type { ToastApi } from "../utils/toast.context";

const toastApi = () => {
  let n = 0;
  const raise = () => `toast-${++n}`;
  return {
    success: jest.fn(raise),
    info: jest.fn(raise),
    warning: jest.fn(raise),
    error: jest.fn(raise),
    show: jest.fn(raise),
    dismiss: jest.fn(),
    dismissAll: jest.fn(),
  } satisfies ToastApi;
};

const renderNotice = (api: ToastApi) =>
  renderHook(() => useRateLimitNotice(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <ToastContext.Provider value={api}>{children}</ToastContext.Provider>
    ),
  });

describe("useRateLimitNotice", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetApiReadPause();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("raises one warning for several refusals in one window, naming the wait", () => {
    const api = toastApi();
    renderNotice(api);

    pauseApiReads(42_000);
    pauseApiReads(41_000);
    pauseApiReads(42_000);

    expect(api.warning).toHaveBeenCalledTimes(1);
    expect(api.warning).toHaveBeenCalledWith(
      "You're making requests faster than allowed. Data will load again in 42 seconds.",
      // Up for the wait it names, not the default warning duration.
      { autoHideMs: 42_000 }
    );
    expect(api.error).not.toHaveBeenCalled();
  });

  it("raises again for the next window", () => {
    const api = toastApi();
    renderNotice(api);

    pauseApiReads(10_000);
    jest.advanceTimersByTime(10_000);
    pauseApiReads(1_000);

    expect(api.warning).toHaveBeenCalledTimes(2);
    expect(api.warning).toHaveBeenLastCalledWith(
      "You're making requests faster than allowed. Data will load again in 1 second.",
      { autoHideMs: 1_000 }
    );
  });

  // Adversarial §3.1: the notice named the first wait and hid with it while
  // a longer refusal kept reads held. It now follows the extended wait.
  it("replaces its notice when a longer refusal extends the window", () => {
    const api = toastApi();
    renderNotice(api);

    pauseApiReads(5_000);
    jest.advanceTimersByTime(1_000);
    pauseApiReads(30_000);

    expect(api.dismiss).toHaveBeenCalledWith("toast-1");
    expect(api.warning).toHaveBeenCalledTimes(2);
    expect(api.warning).toHaveBeenLastCalledWith(
      "You're making requests faster than allowed. Data will load again in 30 seconds.",
      { autoHideMs: 30_000 }
    );
  });

  it("does not dismiss anything for a fresh window", () => {
    const api = toastApi();
    renderNotice(api);

    pauseApiReads(5_000);
    jest.advanceTimersByTime(5_000);
    pauseApiReads(5_000);

    expect(api.warning).toHaveBeenCalledTimes(2);
    expect(api.dismiss).not.toHaveBeenCalled();
  });

  it("stops listening on unmount", () => {
    const api = toastApi();
    const { unmount } = renderNotice(api);
    unmount();

    pauseApiReads(10_000);
    expect(api.warning).not.toHaveBeenCalled();
  });

  it("doesn't throw with no toast provider", () => {
    renderHook(() => useRateLimitNotice());
    expect(() => pauseApiReads(10_000)).not.toThrow();
  });
});
