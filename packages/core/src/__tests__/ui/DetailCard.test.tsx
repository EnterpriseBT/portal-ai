import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { DetailCard } from "../../ui/DetailCard";
import { expectNoAxeViolations } from "../axe.util";

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

  // #794: the title is the card's one control, named by the title alone.
  describe("Clickable Card", () => {
    it("makes the title a button named by the title, inside its heading", () => {
      render(
        <DetailCard title="Alpha" onClick={() => {}}>
          <p>Body text</p>
        </DetailCard>
      );
      const button = screen.getByRole("button", { name: "Alpha" });
      expect(
        screen.getByRole("heading", { level: 3, name: "Alpha" })
      ).toContainElement(button);
    });

    it("makes the title a link with href, through linkComponent", () => {
      const Link = React.forwardRef<HTMLAnchorElement, { href: string }>(
        (props, ref) => <a ref={ref} data-custom="" {...props} />
      );
      Link.displayName = "Link";
      render(
        <DetailCard title="Alpha" href="/alpha" linkComponent={Link}>
          <p>Body text</p>
        </DetailCard>
      );
      const link = screen.getByRole("link", { name: "Alpha" });
      expect(link).toHaveAttribute("href", "/alpha");
      expect(link).toHaveAttribute("data-custom");
    });

    it("leaves the title as plain text without href or onClick", () => {
      render(<DetailCard title="Alpha" />);
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("keeps the body out of the control's name", () => {
      render(
        <DetailCard title="Alpha" onClick={() => {}}>
          <p>Body text</p>
        </DetailCard>
      );
      expect(
        screen.getByRole("button", { name: "Alpha" })
      ).not.toHaveTextContent("Body text");
    });

    it("activates the title when the card's body is clicked", async () => {
      const handleClick = jest.fn();
      render(
        <DetailCard title="Alpha" onClick={handleClick}>
          <p>Body text</p>
        </DetailCard>
      );
      await userEvent.click(screen.getByText("Body text"));
      expect(handleClick).toHaveBeenCalledTimes(1);
      await userEvent.click(screen.getByRole("button", { name: "Alpha" }));
      expect(handleClick).toHaveBeenCalledTimes(2);
    });

    it("opens a link card in a new tab on Ctrl/Cmd-click of its body", () => {
      const open = jest.spyOn(window, "open").mockImplementation(() => null);
      render(
        <DetailCard title="Alpha" href="/alpha">
          <p>Body text</p>
        </DetailCard>
      );
      fireEvent.click(screen.getByText("Body text"), { metaKey: true });
      expect(open).toHaveBeenCalledWith(
        expect.stringContaining("/alpha"),
        "_blank",
        "noopener"
      );
      open.mockRestore();
    });

    it("says once, not per render, that href and onClick don't mix", () => {
      const error = jest.spyOn(console, "error").mockImplementation(() => {});
      const { rerender } = render(
        <DetailCard title="Alpha" href="/alpha" onClick={() => {}} />
      );
      rerender(<DetailCard title="Alpha!" href="/alpha" onClick={() => {}} />);
      expect(
        error.mock.calls.filter((c) => String(c[0]).includes("href or onClick"))
      ).toHaveLength(1);
      error.mockRestore();
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

    it("describes its actions by its title, beside a gate's reason", () => {
      render(
        <DetailCard
          title="Alpha"
          onClick={() => {}}
          actions={[
            { label: "Edit", onClick: jest.fn() },
            {
              label: "Delete",
              onClick: jest.fn(),
              gate: { kind: "disable", reason: "Deleting…" },
            },
          ]}
        />
      );
      expect(
        screen.getByRole("button", { name: "Edit" })
      ).toHaveAccessibleDescription("Alpha");
      expect(
        screen.getByRole("button", { name: "Delete" })
      ).toHaveAccessibleDescription("Alpha Deleting…");
    });

    it("has no axe violations as a link or a button", async () => {
      const { container, rerender } = render(
        <DetailCard
          title="Alpha"
          href="/alpha"
          actions={[{ label: "Edit", onClick: jest.fn() }]}
        >
          <p>Body text</p>
        </DetailCard>
      );
      await expectNoAxeViolations(container);
      rerender(
        <DetailCard
          title="Alpha"
          onClick={() => {}}
          actions={[{ label: "Edit", onClick: jest.fn() }]}
        >
          <p>Body text</p>
        </DetailCard>
      );
      await expectNoAxeViolations(container);
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

  it("#688: renders no actions when every action is hidden, and gates the rest", async () => {
    const onDelete = jest.fn();
    render(
      <DetailCard
        title="Contacts"
        actions={[
          { label: "Share", onClick: jest.fn(), gate: { kind: "hide" } },
          {
            label: "Delete",
            onClick: onDelete,
            gate: { kind: "disable", reason: "Deleting…" },
          },
        ]}
      />
    );
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    const del = screen.getByRole("button", { name: "Delete" });
    expect(del).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(del);
    expect(onDelete).not.toHaveBeenCalled();
  });
});

// #793: subtitles stopped being headings theme-wide, but a card's title is
// one: screen-reader users move between cards by heading.
describe("DetailCard title heading (#793)", () => {
  it("renders its title as an h3 by default", () => {
    render(<DetailCard title="File Upload" />);
    expect(
      screen.getByRole("heading", { level: 3, name: "File Upload" })
    ).toBeInTheDocument();
  });

  it("takes another level where the page needs one", () => {
    render(<DetailCard title="File Upload" headingLevel={2} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "File Upload" })
    ).toBeInTheDocument();
  });
});
