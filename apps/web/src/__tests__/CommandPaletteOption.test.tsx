import { jest } from "@jest/globals";

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const { CommandPaletteOptionUI } =
  await import("../components/CommandPaletteOption.component");

describe("CommandPaletteOptionUI (#1122)", () => {
  it("shows an object's name, type and tag dots", async () => {
    const { container } = render(
      <ul role="listbox" aria-label="Results">
        <li role="option" aria-selected="false">
          <CommandPaletteOptionUI
            entry={{
              kind: "item",
              id: "s1",
              type: "station",
              name: "Finance Close",
              href: "/stations/s1",
              tags: [
                { id: "t1", name: "finance", color: "#2563EB" },
                { id: "t2", name: "plain", color: null },
              ],
            }}
          />
        </li>
      </ul>
    );
    expect(screen.getByRole("option")).toHaveTextContent(
      "Finance Close· station"
    );
    expect(screen.getAllByTestId("tag-color-dot")).toHaveLength(1);
    await expectNoAxeViolations(container);
  });

  it("shows a gated action's reason, hidden from assistive tech", () => {
    render(
      <CommandPaletteOptionUI
        entry={{
          kind: "action",
          id: "invite",
          label: "Invite a member",
          onSelect: jest.fn(),
          gate: { kind: "disable", reason: "Needs member.invite" },
        }}
      />
    );
    expect(screen.getByText("Needs member.invite")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
  });
});
