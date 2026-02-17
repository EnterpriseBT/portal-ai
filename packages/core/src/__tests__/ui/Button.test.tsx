import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { jest } from "@jest/globals";
import { Button } from "../../ui/Button";
import type { ButtonProps } from "../../ui/Button";

describe("Button Component", () => {
  describe("Rendering", () => {
    it("should render children correctly", () => {
      render(<Button>Click me</Button>);

      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent("Click me");
    });

    it("should render with valid props", () => {
      const validProps: ButtonProps = {
        children: "Test Button",
        variant: "contained",
        color: "primary",
        size: "medium",
        disabled: false,
        fullWidth: false,
      };

      render(<Button {...validProps} />);
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    it("should accept custom className", () => {
      render(<Button className="custom-class">Custom</Button>);

      const button = screen.getByRole("button");
      expect(button).toHaveClass("custom-class");
    });

    it("should accept custom data attributes", () => {
      render(<Button data-testid="custom-button">Custom</Button>);

      expect(screen.getByTestId("custom-button")).toBeInTheDocument();
    });
  });

  describe("Interactions", () => {
    it("should call onClick when clicked", () => {
      const handleClick = jest.fn();
      render(<Button onClick={handleClick}>Click me</Button>);

      const button = screen.getByRole("button");
      fireEvent.click(button);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the underlying button element", () => {
      const ref = React.createRef<HTMLButtonElement>();
      render(<Button ref={ref}>Ref Test</Button>);

      expect(ref.current).toBeInstanceOf(HTMLButtonElement);
      expect(ref.current?.textContent).toBe("Ref Test");
    });
  });
});
