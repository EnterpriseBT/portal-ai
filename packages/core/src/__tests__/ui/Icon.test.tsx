import React from "react";
import { render, screen } from "@testing-library/react";
import { Icon, IconName } from "../../ui/Icon";
import type { IconProps } from "../../ui/Icon";

describe("Icon Component", () => {
  describe("Rendering", () => {
    it("should render with predefined icon name", () => {
      render(<Icon name={IconName.Home} data-testid="home-icon" />);

      expect(screen.getByTestId("home-icon")).toBeInTheDocument();
    });

    it("should render with valid props", () => {
      const validProps: IconProps = {
        name: IconName.Delete,
        color: "primary",
        fontSize: "large",
      };

      render(<Icon {...validProps} data-testid="valid-props-icon" />);
      expect(screen.getByTestId("valid-props-icon")).toBeInTheDocument();
    });

    it("should accept custom className", () => {
      render(
        <Icon
          name={IconName.Star}
          className="custom-class"
          data-testid="custom-class-icon"
        />
      );

      const icon = screen.getByTestId("custom-class-icon");
      expect(icon).toHaveClass("custom-class");
    });

    it("should accept custom data attributes", () => {
      render(<Icon name={IconName.Send} data-testid="custom-icon" />);

      expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the underlying SVG element with name prop", () => {
      const ref = React.createRef<SVGSVGElement>();
      render(<Icon ref={ref} name={IconName.Star} />);
      expect(ref.current).toBeInstanceOf(SVGSVGElement);
    });
  });
});
