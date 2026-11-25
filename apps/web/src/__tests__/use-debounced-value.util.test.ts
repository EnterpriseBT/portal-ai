import { jest } from "@jest/globals";

const { renderHook, act } = await import("@testing-library/react");
const { useDebouncedValue } = await import("../utils/use-debounced-value.util");

describe("useDebouncedValue (#1076)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("settles on the last value once it stops changing", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: "a" } }
    );
    rerender({ value: "ab" });
    act(() => jest.advanceTimersByTime(100));
    rerender({ value: "abc" });
    act(() => jest.advanceTimersByTime(199));
    expect(result.current).toBe("a");
    act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBe("abc");
  });
});
