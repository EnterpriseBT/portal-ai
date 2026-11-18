import React from "react";
import { jest } from "@jest/globals";

// #1059: a Help entry link carries its anchor (`/help#faq-entry-…`).
// TanStack's `to` takes a path, so RouterLink passes the fragment as `hash`;
// otherwise the link lands on Help without reaching the entry. The router's
// Link is stubbed to show what it receives.
jest.unstable_mockModule("@tanstack/react-router", () => ({
  Link: React.forwardRef<
    HTMLAnchorElement,
    { to: string; hash?: string; children?: React.ReactNode }
  >(({ to, hash, children, ...rest }, ref) => (
    <a ref={ref} data-to={to} data-hash={hash ?? ""} {...rest}>
      {children}
    </a>
  )),
}));

const { render, screen } = await import("@testing-library/react");
const { RouterLink } = await import("../components/RouterLink.component");

describe("RouterLink fragment", () => {
  it("passes a #fragment to the router as hash", () => {
    render(
      <RouterLink href="/help#faq-entry-how-do-tags-work">Tags</RouterLink>
    );
    const link = screen.getByText("Tags");
    expect(link).toHaveAttribute("data-to", "/help");
    expect(link).toHaveAttribute("data-hash", "faq-entry-how-do-tags-work");
  });

  it("leaves an href without a fragment as the path", () => {
    render(<RouterLink href="/entities/ent-1">Customers</RouterLink>);
    const link = screen.getByText("Customers");
    expect(link).toHaveAttribute("data-to", "/entities/ent-1");
    expect(link).toHaveAttribute("data-hash", "");
  });
});
