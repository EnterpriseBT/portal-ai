import type React from "react";
import { render, screen, expectNoAxeViolations } from "./test-utils";
import userEvent from "@testing-library/user-event";
import { SkipLinks, SkipLinksUI } from "../components/SkipLinks.component";

const Page = ({ children }: { children: React.ReactNode }) => (
  <>
    {children}
    <button>Header control</button>
    <main id="main-content" tabIndex={-1}>
      <h1>Page</h1>
    </main>
  </>
);

describe("SkipLinksUI (#797)", () => {
  const targets = [{ id: "main-content", label: "Skip to main content" }];

  it("renders a named nav of in-page links", () => {
    render(<SkipLinksUI targets={targets} />);
    const nav = screen.getByRole("navigation", { name: "Skip links" });
    const link = screen.getByRole("link", { name: "Skip to main content" });
    expect(nav).toContainElement(link);
    expect(link).toHaveAttribute("href", "#main-content");
  });

  it("is the first thing Tab reaches", async () => {
    const user = userEvent.setup();
    render(
      <Page>
        <SkipLinksUI targets={targets} />
      </Page>
    );
    await user.tab();
    expect(
      screen.getByRole("link", { name: "Skip to main content" })
    ).toHaveFocus();
  });

  it("moves focus to its target when activated", async () => {
    const user = userEvent.setup();
    render(
      <Page>
        <SkipLinksUI targets={targets} />
      </Page>
    );
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <Page>
        <SkipLinksUI targets={targets} />
      </Page>
    );
    await expectNoAxeViolations(container);
  });
});

describe("SkipLinks", () => {
  it("always offers the main content", () => {
    render(<SkipLinks />);
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Skip to main content",
    ]);
  });
});
