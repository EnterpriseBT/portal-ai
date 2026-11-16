import { jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";

import {
  announcementFor,
  useResultsAnnouncer,
  SETTLE_MS,
  LOADING_DELAY_MS,
  REANNOUNCE_GAP_MS,
} from "../utils/results-announcer.util";

// #794: after a user changes a list, a screen reader hears the new result
// count once it settles; arriving on a page says nothing extra.
describe("announcementFor", () => {
  it("says the count, and No results found for none", () => {
    expect(announcementFor(0)).toBe("No results found");
    expect(announcementFor(1)).toBe("1 result");
    expect(announcementFor(12)).toBe("12 results");
    expect(announcementFor(1234)).toBe(`${(1234).toLocaleString()} results`);
  });
});

describe("useResultsAnnouncer", () => {
  type State = {
    loading: boolean;
    total: number;
    currentPage: number;
    totalPages: number;
  };
  const start: State = {
    loading: false,
    total: 12,
    currentPage: 1,
    totalPages: 2,
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const setup = (initial: State = start) =>
    renderHook((props: State) => useResultsAnnouncer(props), {
      initialProps: initial,
    });

  const advance = (ms: number) =>
    act(() => {
      jest.advanceTimersByTime(ms);
    });

  it("announces nothing on mount", () => {
    const { result } = setup();
    advance(SETTLE_MS * 4);
    expect(result.current.announcement).toBe("");
  });

  it("announces the count and page once a change settles", () => {
    const { result } = setup();
    act(() => result.current.markChange());
    advance(SETTLE_MS - 1);
    expect(result.current.announcement).toBe("");
    advance(1);
    advance(REANNOUNCE_GAP_MS);
    expect(result.current.announcement).toBe("12 results, page 1 of 2");
  });

  it("leaves out the page when there's one page", () => {
    const { result } = setup({ ...start, total: 0, totalPages: 1 });
    act(() => result.current.markChange());
    advance(SETTLE_MS);
    advance(REANNOUNCE_GAP_MS);
    expect(result.current.announcement).toBe("No results found");
  });

  it("restarts the settle on each change, so typing isn't announced per key", () => {
    const { result } = setup();
    act(() => result.current.markChange());
    advance(SETTLE_MS - 100);
    act(() => result.current.markChange());
    advance(SETTLE_MS - 100);
    expect(result.current.announcement).toBe("");
    advance(100);
    advance(REANNOUNCE_GAP_MS);
    expect(result.current.announcement).toBe("12 results, page 1 of 2");
  });

  it("says Loading results… only when loading outlasts the delay, then the count", () => {
    const { result, rerender } = setup();
    act(() => result.current.markChange());
    rerender({ ...start, loading: true });
    advance(LOADING_DELAY_MS - 1);
    expect(result.current.announcement).toBe("");
    advance(1);
    advance(REANNOUNCE_GAP_MS);
    expect(result.current.announcement).toBe("Loading results…");
    rerender({ ...start, loading: false, total: 3, totalPages: 1 });
    advance(SETTLE_MS);
    advance(REANNOUNCE_GAP_MS);
    expect(result.current.announcement).toBe("3 results");
  });

  it("never says Loading for a quick load", () => {
    const { result, rerender } = setup();
    act(() => result.current.markChange());
    rerender({ ...start, loading: true });
    advance(100);
    rerender({ ...start, loading: false, total: 5, totalPages: 1 });
    advance(SETTLE_MS);
    advance(REANNOUNCE_GAP_MS);
    expect(result.current.announcement).toBe("5 results");
  });

  it("re-announces the same count after another change", () => {
    const { result } = setup();
    act(() => result.current.markChange());
    advance(SETTLE_MS);
    advance(REANNOUNCE_GAP_MS);
    expect(result.current.announcement).toBe("12 results, page 1 of 2");
    act(() => result.current.markChange());
    advance(SETTLE_MS);
    expect(result.current.announcement).toBe("");
    advance(REANNOUNCE_GAP_MS);
    expect(result.current.announcement).toBe("12 results, page 1 of 2");
  });
});
