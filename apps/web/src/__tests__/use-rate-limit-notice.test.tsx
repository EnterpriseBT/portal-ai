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

const toastApi = () =>
  ({
    success: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    show: jest.fn(),
    dismiss: jest.fn(),
    dismissAll: jest.fn(),
  }) satisfies ToastApi;

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
