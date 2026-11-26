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

describe("useDebouncedValue immediate (#1076 code review)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("passes an immediate value through at once and drops the pending one", () => {
    const { result, rerender } = renderHook(
      ({ value, immediate }) => useDebouncedValue(value, 200, { immediate }),
      { initialProps: { value: "sal", immediate: false } }
    );
    rerender({ value: "sales", immediate: false });
    rerender({ value: "", immediate: true });
    expect(result.current).toBe("");
    rerender({ value: "x", immediate: false });
    expect(result.current).toBe("");
    act(() => jest.advanceTimersByTime(200));
    expect(result.current).toBe("x");
  });
});
