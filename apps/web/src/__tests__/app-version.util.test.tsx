import { jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";

import { useAppVersion } from "../utils/app-version.util";

// ── Helpers ─────────────────────────────────────────────────────────

function mockFetchJson(version: string) {
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ version }),
  } as Response);
  return global.fetch as jest.Mock<typeof global.fetch>;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("useAppVersion", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("starts with updateAvailable as false", async () => {
    const fetchMock = mockFetchJson("v1");

    const { result } = renderHook(() => useAppVersion(1000));

    // Flush the initial fetch promise
    await act(() => jest.advanceTimersByTimeAsync(0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.updateAvailable).toBe(false);
  });

  it("detects a version change after polling", async () => {
    const fetchMock = mockFetchJson("v1");

    const { result } = renderHook(() => useAppVersion(1000));

    // Flush initial fetch
    await act(() => jest.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Change the version for subsequent fetches
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "v2" }),
    } as Response);

    // Advance past the poll interval
    await act(() => jest.advanceTimersByTimeAsync(1000));

    expect(result.current.updateAvailable).toBe(true);
  });

  it("stays false when the version has not changed", async () => {
    const fetchMock = mockFetchJson("v1");

    const { result } = renderHook(() => useAppVersion(1000));

    await act(() => jest.advanceTimersByTimeAsync(0));

    // Advance past the poll interval — version still "v1"
    await act(() => jest.advanceTimersByTimeAsync(1000));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.updateAvailable).toBe(false);
  });

  it("handles fetch errors gracefully", async () => {
    const fetchMock = mockFetchJson("v1");

    const { result } = renderHook(() => useAppVersion(1000));

    await act(() => jest.advanceTimersByTimeAsync(0));

    // Subsequent fetch fails
    fetchMock.mockRejectedValue(new Error("network error"));

    await act(() => jest.advanceTimersByTimeAsync(1000));

    expect(result.current.updateAvailable).toBe(false);
  });

  it("dismiss hides the banner even when update is available", async () => {
    const fetchMock = mockFetchJson("v1");

    const { result } = renderHook(() => useAppVersion(1000));

    await act(() => jest.advanceTimersByTimeAsync(0));

    // Return a new version
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "v2" }),
    } as Response);

    await act(() => jest.advanceTimersByTimeAsync(1000));

    expect(result.current.updateAvailable).toBe(true);

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.updateAvailable).toBe(false);
  });

  it("does not start polling if initial fetch fails", async () => {
    global.fetch = jest
      .fn<typeof global.fetch>()
      .mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useAppVersion(1000));

    await act(() => jest.advanceTimersByTimeAsync(0));

    // Advance well past the poll interval
    await act(() => jest.advanceTimersByTimeAsync(5000));

    // Only the initial fetch was attempted — no polling started
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.current.updateAvailable).toBe(false);
  });
});
