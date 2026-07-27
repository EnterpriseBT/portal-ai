import React from "react";
import { renderHook } from "@testing-library/react";

import { ScrollRootContext, useScrollRoot } from "../utils/scroll-root.context";

describe("useScrollRoot (#271)", () => {
  it("returns the provided scroll-root element", () => {
    const el = document.createElement("div");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ScrollRootContext.Provider value={el}>
        {children}
      </ScrollRootContext.Provider>
    );
    const { result } = renderHook(() => useScrollRoot(), { wrapper });
    expect(result.current).toBe(el);
  });

  it("returns null with no provider", () => {
    const { result } = renderHook(() => useScrollRoot());
    expect(result.current).toBeNull();
  });
});
