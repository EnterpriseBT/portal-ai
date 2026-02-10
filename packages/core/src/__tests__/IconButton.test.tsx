import React from "react";
import { render, screen } from "@testing-library/react";
import { IconButton } from "../IconButton";
import { IconName } from "../Icon";

describe("IconButton Component", () => {
  describe("Rendering", () => {
    it("should render correctly", () => {
      render(<IconButton icon={IconName.Home} aria-label="home button" />);

      const button = screen.getByRole("button", { name: /home button/i });
      expect(button).toBeInTheDocument();
    });
  });

  describe("Icon Display", () => {
    it("should display the correct icon", () => {
      const { container } = render(
        <IconButton icon={IconName.Home} aria-label="home button" />,
      );

      // Check that the icon component is rendered inside the button
      const button = screen.getByRole("button");
      const icon = button.querySelector("svg");
      expect(icon).toBeInTheDocument();
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the underlying button element", () => {
      const ref = React.createRef<HTMLButtonElement>();
      render(<IconButton ref={ref} icon={IconName.Home} aria-label="home button" />);

      expect(ref.current).toBeInstanceOf(HTMLButtonElement);
      expect(ref.current?.getAttribute("type")).toBe("button");
    });
  });
});
