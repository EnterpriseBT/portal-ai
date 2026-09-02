import React from "react";
import { render, screen } from "@testing-library/react";
import { Progress } from "../../ui/Progress";

describe("Progress Component", () => {
  describe("Rendering", () => {
    it("should render the progress bar", () => {
      render(<Progress value={50} />);
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    it("should display the percentage label by default", () => {
      render(<Progress value={45} />);
      expect(screen.getByText("45%")).toBeInTheDocument();
    });

    it("should round the percentage label", () => {
      render(<Progress value={33.7} />);
      expect(screen.getByText("34%")).toBeInTheDocument();
    });

    it("should hide the label when showLabel is false", () => {
      render(<Progress value={50} showLabel={false} />);
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
      expect(screen.queryByText("50%")).not.toBeInTheDocument();
    });

    it("should clamp value to 0 when negative", () => {
      render(<Progress value={-10} />);
      expect(screen.getByText("0%")).toBeInTheDocument();
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "0"
      );
    });

    it("should clamp value to 100 when exceeding max", () => {
      render(<Progress value={150} />);
      expect(screen.getByText("100%")).toBeInTheDocument();
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "100"
      );
    });

    it("should display 0% for zero value", () => {
      render(<Progress value={0} />);
      expect(screen.getByText("0%")).toBeInTheDocument();
    });

    it("should display 100% for complete value", () => {
      render(<Progress value={100} />);
      expect(screen.getByText("100%")).toBeInTheDocument();
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the underlying div element", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<Progress ref={ref} value={50} />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe("Custom Props", () => {
    it("should accept custom className", () => {
      const { container } = render(
        <Progress className="custom-class" value={50} />
      );
      expect(container.firstChild).toHaveClass("custom-class");
    });

    it("should accept custom data attributes", () => {
      render(<Progress data-testid="my-progress" value={50} />);
      expect(screen.getByTestId("my-progress")).toBeInTheDocument();
    });
  });
});

describe("Indeterminate mode (#458)", () => {
  it("renders an indeterminate bar with no percent label", () => {
    render(<Progress value={0} indeterminate />);
    const bar = screen.getByRole("progressbar");
    // MUI's indeterminate variant carries no aria-valuenow — there is no
    // claimed position, which is the point.
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("keeps the determinate default when indeterminate is not set", () => {
    render(<Progress value={40} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "40"
    );
  });
});

describe("Inherit color mode (#458 toast contrast)", () => {
  it("renders the bar with MUI's colorInherit class", () => {
    render(<Progress value={40} color="inherit" />);
    expect(screen.getByRole("progressbar").className).toContain(
      "MuiLinearProgress-colorInherit"
    );
  });

  it("does not crash when animated (no palette lookup for inherit)", () => {
    render(<Progress value={40} color="inherit" animated />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("supports indeterminate + inherit together", () => {
    render(<Progress value={0} color="inherit" indeterminate />);
    const bar = screen.getByRole("progressbar");
    expect(bar.className).toContain("MuiLinearProgress-colorInherit");
    expect(bar).not.toHaveAttribute("aria-valuenow");
  });
});
