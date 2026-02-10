import React from "react";
import { render, screen } from "@testing-library/react";
import { Typography } from "../Typography";
import type { TypographyProps } from "../Typography";

describe("Typography Component", () => {
  describe("Rendering", () => {
    it("should render children correctly", () => {
      render(<Typography>Hello World</Typography>);

      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    it("should render with valid props", () => {
      const validProps: TypographyProps = {
        children: "Test Typography",
        variant: "h1",
        color: "primary",
        align: "center",
        gutterBottom: true,
        noWrap: false,
      };

      render(<Typography {...validProps} />);
      expect(screen.getByText("Test Typography")).toBeInTheDocument();
    });

    it("should accept custom className", () => {
      render(<Typography className="custom-class">Custom</Typography>);

      const element = screen.getByText("Custom");
      expect(element).toHaveClass("custom-class");
    });

    it("should accept custom data attributes", () => {
      render(<Typography data-testid="custom-typography">Custom</Typography>);

      expect(screen.getByTestId("custom-typography")).toBeInTheDocument();
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the underlying element", () => {
      const ref = React.createRef<HTMLElement>();
      render(<Typography ref={ref}>Ref Test</Typography>);

      expect(ref.current).toBeInstanceOf(HTMLElement);
      expect(ref.current?.textContent).toBe("Ref Test");
    });

    it("should forward ref with custom component", () => {
      const ref = React.createRef<HTMLElement>();
      render(
        <Typography ref={ref} component="h1">
          H1 Ref Test
        </Typography>,
      );

      expect(ref.current).toBeInstanceOf(HTMLHeadingElement);
      expect(ref.current?.textContent).toBe("H1 Ref Test");
    });
  });
});
