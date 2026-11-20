import { jest } from "@jest/globals";
import React from "react";
import type { TroubleshootingEntry } from "@portalai/core/content";

const { render, screen, within, expectNoAxeViolations } =
  await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { TroubleshootingListUI } =
  await import("../components/TroubleshootingList.component");

const fixture: TroubleshootingEntry[] = [
  {
    symptom: "A sync or import job failed",
    cause: "The source was unreachable.",
    fix: "Open Jobs and read the error.",
    related: [
      { surface: "faq", title: "Why did my job fail?" },
      { surface: "glossary", title: "Job Status" },
    ],
  },
  {
    symptom: "The assistant says I've reached my turn limit",
    cause: "The plan's turn limit was reached.",
    fix: "Wait for it to reset.",
  },
];

/** Expansion is controlled (#365); this harness holds the set. */
const Controlled: React.FC<{
  initialExpanded?: string[];
  onSelectRelated?: (surface: "faq" | "glossary", title: string) => void;
}> = ({ initialExpanded = [], onSelectRelated = jest.fn() }) => {
  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set(initialExpanded)
  );
  return (
    <TroubleshootingListUI
      entries={fixture}
      expandedSlugs={expanded}
      onToggleEntry={(slug) =>
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(slug)) next.delete(slug);
          else next.add(slug);
          return next;
        })
      }
      onSelectRelated={onSelectRelated}
    />
  );
};

describe("TroubleshootingListUI (#1049)", () => {
  it("lists every symptom, with its cause and fix under labels when open", async () => {
    render(<Controlled />);
    expect(
      screen.getByRole("button", { name: "A sync or import job failed" })
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "A sync or import job failed" })
    );
    const entry = screen.getByTestId(
      "troubleshooting-entry-a-sync-or-import-job-failed"
    );
    expect(within(entry).getByText("Why it happens")).toBeVisible();
    expect(
      within(entry).getByText("The source was unreachable.")
    ).toBeVisible();
    expect(within(entry).getByText("What to do")).toBeVisible();
    expect(
      within(entry).getByText("Open Jobs and read the error.")
    ).toBeVisible();
  });

  it("reports a related entry with its surface", async () => {
    const onSelectRelated = jest.fn();
    render(
      <Controlled
        initialExpanded={["a-sync-or-import-job-failed"]}
        onSelectRelated={onSelectRelated}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Job Status" }));
    expect(onSelectRelated).toHaveBeenCalledWith("glossary", "Job Status");
  });

  it("has no axe violations, closed and with an entry open", async () => {
    const closed = render(<Controlled />);
    await expectNoAxeViolations(closed.container);
    closed.unmount();
    const open = render(
      <Controlled initialExpanded={["a-sync-or-import-job-failed"]} />
    );
    await expectNoAxeViolations(open.container);
  });
});
