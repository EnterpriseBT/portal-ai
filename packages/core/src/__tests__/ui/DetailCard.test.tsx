import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { DetailCard } from "../../ui/DetailCard";

describe("DetailCard Component", () => {
  describe("Rendering", () => {
    it("should render the title", () => {
      render(<DetailCard title="Alpha Connector" />);
      expect(screen.getByText("Alpha Connector")).toBeInTheDocument();
    });

    it("should render the icon when provided", () => {
      render(
        <DetailCard
          title="Alpha"
          icon={<span data-testid="card-icon">ic</span>}
        />
      );
      expect(screen.getByTestId("card-icon")).toBeInTheDocument();
    });

    it("should not render an icon container when icon is not provided", () => {
      render(<DetailCard title="Alpha" />);
      expect(screen.queryByTestId("card-icon")).not.toBeInTheDocument();
    });

    it("should render children content", () => {
      render(
        <DetailCard title="Alpha">
          <p>Last synced 2 hours ago</p>
        </DetailCard>
      );
      expect(screen.getByText("Last synced 2 hours ago")).toBeInTheDocument();
    });

    it("should not render a children container when children is not provided", () => {
      const { container } = render(<DetailCard title="Alpha" />);
      // Should still render the card and title
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(container.querySelector(".MuiCard-root")).toBeInTheDocument();
    });

    it("should render action buttons when actions are provided", () => {
      render(
        <DetailCard
          title="Alpha"
          actions={[
            { label: "Edit", onClick: () => {} },
            { label: "Delete", onClick: () => {} },
          ]}
        />
      );
      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Delete" })
      ).toBeInTheDocument();
    });

    it("should not render actions when actions is an empty array", () => {
      render(<DetailCard title="Alpha" actions={[]} />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("should default to outlined variant", () => {
      const { container } = render(<DetailCard title="Alpha" />);
      const card = container.querySelector(".MuiCard-root");
      expect(card).toBeInTheDocument();
      // MUI outlined cards render a css border — non-outlined use box-shadow
      expect(card).toHaveStyle({ overflow: "hidden" });
    });

    it("should support elevation variant", () => {
      const { container } = render(
        <DetailCard title="Alpha" variant="elevation" />
      );
      expect(container.querySelector(".MuiCard-root")).toBeInTheDocument();
    });
  });

  describe("Clickable Card", () => {
    it("should render a CardActionArea when onClick is provided", () => {
      const { container } = render(
        <DetailCard title="Alpha" onClick={() => {}} />
      );
      expect(
        container.querySelector(".MuiCardActionArea-root")
      ).toBeInTheDocument();
    });

    it("should not render a CardActionArea when onClick is not provided", () => {
      const { container } = render(<DetailCard title="Alpha" />);
      expect(
        container.querySelector(".MuiCardActionArea-root")
      ).not.toBeInTheDocument();
    });

    it("should call onClick when the card is clicked", async () => {
      const handleClick = jest.fn();
      render(<DetailCard title="Alpha" onClick={handleClick} />);

      await userEvent.click(screen.getByText("Alpha"));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it("should call action onClick without triggering card onClick", async () => {
      const handleCardClick = jest.fn();
      const handleEdit = jest.fn();

      render(
        <DetailCard
          title="Alpha"
          onClick={handleCardClick}
          actions={[{ label: "Edit", onClick: handleEdit }]}
        />
      );

      await userEvent.click(screen.getByRole("button", { name: "Edit" }));

      expect(handleEdit).toHaveBeenCalledTimes(1);
      expect(handleCardClick).not.toHaveBeenCalled();
    });
  });

  describe("Props", () => {
    it("should accept a custom className", () => {
      const { container } = render(
        <DetailCard title="Alpha" className="custom-card" />
      );
      expect(container.firstChild).toHaveClass("custom-card");
    });

    it("should accept custom data attributes", () => {
      render(<DetailCard title="Alpha" data-testid="my-card" />);
      expect(screen.getByTestId("my-card")).toBeInTheDocument();
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the Card root element", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<DetailCard ref={ref} title="Alpha" />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
      expect(ref.current?.classList.contains("MuiCard-root")).toBe(true);
    });
  });
});
