import React from "react";
import type { HelpBlockContent } from "@portalai/core/contracts";

const { render, screen, within, expectNoAxeViolations } =
  await import("./test-utils");
const { HelpBlockUI } = await import("../components/HelpBlock.component");

/** A plain anchor stands in for the router link. */
const Anchor = React.forwardRef<
  HTMLAnchorElement,
  React.AnchorHTMLAttributes<HTMLAnchorElement>
>((props, ref) => <a ref={ref} {...props} />);
Anchor.displayName = "Anchor";

const BODY =
  "Open the Connectors page, switch to the Catalog tab, and pick a connector definition.\nThen map its columns.";

const content: HelpBlockContent = {
  type: "help",
  query: "How do I bring in a spreadsheet?",
  entries: [
    {
      surface: "faq",
      slug: "how-do-i-connect-my-first-data-source",
      title: "How do I connect my first data source?",
      url: "/help?tab=faq#faq-entry-how-do-i-connect-my-first-data-source",
      body: BODY,
    },
    {
      surface: "troubleshooting",
      slug: "an-import-finished-but-no-records-appeared",
      title: "An import finished but no records appeared",
      url: "/help?tab=troubleshooting#troubleshooting-entry-an-import-finished-but-no-records-appeared",
      body: "Why it happens: x\nWhat to do: y",
    },
  ],
  candidates: [
    {
      surface: "glossary",
      slug: "connector-instance",
      title: "Connector Instance",
      url: "/help?tab=glossary#glossary-entry-connector-instance",
    },
  ],
  noMatch: false,
  helpUrl: "/help?tab=getting-started",
};

const noMatch: HelpBlockContent = {
  type: "help",
  query: "weather in paris",
  entries: [],
  candidates: [],
  noMatch: true,
  helpUrl: "/help?tab=getting-started",
};

describe("HelpBlockUI (#1049)", () => {
  it("quotes each entry's body exactly, under its title and surface", () => {
    render(<HelpBlockUI content={content} linkComponent={Anchor} />);
    const entry = screen.getByTestId(
      "help-block-entry-faq-how-do-i-connect-my-first-data-source"
    );
    expect(within(entry).getByText("FAQ")).toBeInTheDocument();
    expect(
      within(entry).getByText("How do I connect my first data source?")
    ).toBeInTheDocument();
    expect(within(entry).getByTestId("help-block-body").textContent).toBe(BODY);
  });

  it("links each entry and each candidate into Help", () => {
    render(<HelpBlockUI content={content} linkComponent={Anchor} />);
    expect(
      screen.getByRole("link", {
        name: "Open “How do I connect my first data source?” in Help",
      })
    ).toHaveAttribute(
      "href",
      "/help?tab=faq#faq-entry-how-do-i-connect-my-first-data-source"
    );
    expect(
      screen.getByRole("link", { name: "Connector Instance" })
    ).toHaveAttribute(
      "href",
      "/help?tab=glossary#glossary-entry-connector-instance"
    );
  });

  it("names each block after its question, so two in one conversation differ", () => {
    render(
      <>
        <HelpBlockUI content={content} linkComponent={Anchor} />
        <HelpBlockUI content={noMatch} linkComponent={Anchor} />
      </>
    );
    expect(
      screen.getByRole("region", {
        name: "Help: How do I bring in a spreadsheet?",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Help: weather in paris" })
    ).toBeInTheDocument();
  });

  it("names a bare call's block after its first entry", () => {
    render(
      <HelpBlockUI content={{ ...content, query: "" }} linkComponent={Anchor} />
    );
    expect(
      screen.getByRole("region", {
        name: "Help: How do I connect my first data source?",
      })
    ).toBeInTheDocument();
  });

  it("shows related entries as link chips, not a bulleted list", () => {
    render(<HelpBlockUI content={content} linkComponent={Anchor} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    const related = screen.getByTestId("help-block-related");
    expect(
      within(related).getByRole("link", { name: "Connector Instance" })
    ).toBeInTheDocument();
  });

  it("says no entry covers a question nothing matched, with a way into Help", () => {
    render(<HelpBlockUI content={noMatch} linkComponent={Anchor} />);
    expect(screen.getByText("No help entry covers this.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse Help" })).toHaveAttribute(
      "href",
      "/help?tab=getting-started"
    );
  });

  it("has no axe violations, with entries and with no match", async () => {
    const withEntries = render(
      <HelpBlockUI content={content} linkComponent={Anchor} />
    );
    await expectNoAxeViolations(withEntries.container);
    withEntries.unmount();
    const none = render(
      <HelpBlockUI content={noMatch} linkComponent={Anchor} />
    );
    await expectNoAxeViolations(none.container);
  });
});
