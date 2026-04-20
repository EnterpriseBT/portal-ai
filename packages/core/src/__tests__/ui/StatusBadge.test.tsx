import React from "react";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "../../ui/StatusBadge";
import type { StatusBadgeVariant } from "../../ui/StatusBadge";

describe("StatusBadge Component", () => {
  describe("Rendering", () => {
    const statuses: StatusBadgeVariant[] = [
      "pending",
      "active",
      "completed",
      "failed",
      "stalled",
      "cancelled",
    ];

    it.each(statuses)(
      "should render %s status with capitalized label",
      (status) => {
        render(<StatusBadge status={status} />);
        const expected = status.charAt(0).toUpperCase() + status.slice(1);
        expect(screen.getByText(expected)).toBeInTheDocument();
      }
    );

    it("should use custom label when provided", () => {
      render(<StatusBadge status="active" label="In Progress" />);
      expect(screen.getByText("In Progress")).toBeInTheDocument();
      expect(screen.queryByText("Active")).not.toBeInTheDocument();
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the underlying div element", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<StatusBadge ref={ref} status="pending" />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe("Custom Props", () => {
    it("should accept custom className", () => {
      const { container } = render(
        <StatusBadge className="custom-class" status="completed" />
      );
      expect(container.firstChild).toHaveClass("custom-class");
    });

    it("should accept custom data attributes", () => {
      render(<StatusBadge data-testid="status-badge" status="failed" />);
      expect(screen.getByTestId("status-badge")).toBeInTheDocument();
    });
  });
});
