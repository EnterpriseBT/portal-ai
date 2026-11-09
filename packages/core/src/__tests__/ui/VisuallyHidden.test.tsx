import React from "react";
import { render, screen } from "@testing-library/react";

import { VisuallyHidden } from "../../ui/VisuallyHidden";

// #794: screen-reader-only text.
describe("VisuallyHidden", () => {
  it("keeps its text in the accessibility tree", () => {
    render(
      <button type="button">
        <VisuallyHidden>Close dialog</VisuallyHidden>
      </button>
    );
    expect(
      screen.getByRole("button", { name: "Close dialog" })
    ).toBeInTheDocument();
  });
});
