import React from "react";
import { render, screen, within } from "@testing-library/react";

import { LinkList } from "../../ui/LinkList";
import { expectNoAxeViolations } from "../axe.util";

const items = [
  {
    id: "a",
    href: "/a",
    primary: "Alpha",
    secondary: "Station",
    icon: <svg data-testid="icon-a" />,
  },
  { id: "b", href: "/b", primary: "Beta" },
];

describe("LinkList", () => {
  it("is a named list with one link per item", async () => {
    const { container } = render(
      <LinkList aria-label="Matches" items={items} />
    );
    const list = screen.getByRole("list", { name: "Matches" });
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/a");
    expect(links[0]).toHaveTextContent("AlphaStation");
    expect(links[1]).toHaveTextContent("Beta");
    await expectNoAxeViolations(container);
  });

  it("hides the decorative icon from assistive tech", () => {
    render(<LinkList aria-label="Matches" items={items} />);
    expect(screen.getByTestId("icon-a").parentElement).toHaveAttribute(
      "aria-hidden",
      "true"
    );
  });

  it("renders links through the given component", () => {
    const Custom = React.forwardRef<
      HTMLAnchorElement,
      { href: string; children?: React.ReactNode }
    >(({ href, children, ...rest }, ref) => (
      <a ref={ref} href={href} data-custom="yes" {...rest}>
        {children}
      </a>
    ));
    Custom.displayName = "Custom";
    render(
      <LinkList aria-label="Matches" items={items} linkComponent={Custom} />
    );
    expect(screen.getAllByRole("link")[0]).toHaveAttribute(
      "data-custom",
      "yes"
    );
  });
});
