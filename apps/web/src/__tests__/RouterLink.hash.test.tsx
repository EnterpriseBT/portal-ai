import React from "react";
import { jest } from "@jest/globals";

// #1059: a Help entry link carries its anchor (`/help#faq-entry-…`).
// TanStack's `to` takes a path, so RouterLink passes the fragment as `hash`;
// otherwise the link lands on Help without reaching the entry. The router's
// Link is stubbed to show what it receives.
jest.unstable_mockModule("@tanstack/react-router", () => ({
  Link: React.forwardRef<
    HTMLAnchorElement,
    {
      to: string;
      hash?: string;
      search?: Record<string, string>;
      children?: React.ReactNode;
    }
  >(({ to, hash, search, children, ...rest }, ref) => (
    <a
      ref={ref}
      data-to={to}
      data-hash={hash ?? ""}
      data-search={search ? JSON.stringify(search) : ""}
      {...rest}
    >
      {children}
    </a>
  )),
}));

const { render, screen } = await import("@testing-library/react");
const { RouterLink } = await import("../components/RouterLink.component");

describe("RouterLink URL parts", () => {
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

  // A query goes to the router as `search`, not as part of the path, which
  // TanStack would treat as a route that doesn't exist.
  it("passes a ?query as search and keeps the fragment", () => {
    render(
      <RouterLink href="/help?tab=faq#faq-entry-how-do-tags-work">
        Help
      </RouterLink>
    );
    const link = screen.getByText("Help");
    expect(link).toHaveAttribute("data-to", "/help");
    expect(link).toHaveAttribute("data-search", '{"tab":"faq"}');
    expect(link).toHaveAttribute("data-hash", "faq-entry-how-do-tags-work");
  });

  it("stays on the current route for a bare #fragment", () => {
    render(<RouterLink href="#section">Section</RouterLink>);
    const link = screen.getByText("Section");
    expect(link).toHaveAttribute("data-to", ".");
    expect(link).toHaveAttribute("data-hash", "section");
  });
});
