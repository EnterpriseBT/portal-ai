import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";

import { Combobox } from "../../ui/Combobox";
import type { ComboboxOption } from "../../ui/Combobox";
import { expectNoAxeViolations } from "../axe.util";

const options = (onNew = jest.fn()): ComboboxOption[] => [
  { id: "new", label: "New portal", group: "Actions", onSelect: onNew },
  {
    id: "invite",
    label: "Invite a member",
    group: "Actions",
    onSelect: jest.fn(),
    gate: { kind: "disable", reason: "Needs member.invite" },
  },
  { id: "hidden", label: "Hidden", group: "Actions", gate: { kind: "hide" } },
  { id: "st-1", label: "Sales Ops", group: "Favorites", href: "/stations/1" },
  { id: "st-2", label: "Finance", group: "Favorites", href: "/stations/2" },
];

const Harness = ({
  opts,
  linkComponent,
}: {
  opts: ComboboxOption[];
  linkComponent?: React.ElementType;
}) => {
  const [value, setValue] = React.useState("");
  return (
    <Combobox
      options={opts}
      inputValue={value}
      onInputChange={setValue}
      label="Search and actions"
      statusText={`${opts.length} results`}
      linkComponent={linkComponent}
      emptyContent={<p>Nothing matches</p>}
    />
  );
};

describe("Combobox (#1122)", () => {
  it("lists grouped options under labelled groups, without hidden ones", async () => {
    const { container } = render(<Harness opts={options()} />);
    const input = screen.getByRole("combobox", { name: "Search and actions" });
    expect(input).toHaveAttribute(
      "aria-controls",
      screen.getByRole("listbox").id
    );
    expect(screen.getByRole("group", { name: "Actions" })).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Favorites" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Hidden" })).toBeNull();
    expect(screen.getByRole("option", { name: "Sales Ops" })).toHaveAttribute(
      "href",
      "/stations/1"
    );
    expect(screen.getByRole("status")).toHaveTextContent("5 results");
    await expectNoAxeViolations(container);
  });

  it("highlights the first option and moves with the arrow keys and Home/End", async () => {
    render(<Harness opts={options()} />);
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    const active = () =>
      document.getElementById(
        input.getAttribute("aria-activedescendant") ?? ""
      );
    expect(active()).toHaveTextContent("New portal");
    await userEvent.keyboard("{ArrowDown}");
    expect(active()).toHaveTextContent("Invite a member");
    await userEvent.keyboard("{End}");
    expect(active()).toHaveTextContent("Finance");
    await userEvent.keyboard("{Home}");
    expect(active()).toHaveTextContent("New portal");
  });

  it("describes a gated option by its reason, outside its name", () => {
    render(<Harness opts={options()} />);
    const gated = screen.getByRole("option", { name: "Invite a member" });
    expect(gated).toHaveAttribute("aria-disabled", "true");
    expect(gated).toHaveAccessibleDescription("Needs member.invite");
  });

  it("runs an action option on Enter, and not a disabled one", async () => {
    const onNew = jest.fn();
    const opts = options(onNew);
    render(<Harness opts={opts} />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.keyboard("{Enter}");
    expect(onNew).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(opts[1].onSelect).not.toHaveBeenCalled();
  });

  it("follows a link option on Enter through the link component", async () => {
    const followed: string[] = [];
    const Link = React.forwardRef<
      HTMLAnchorElement,
      React.AnchorHTMLAttributes<HTMLAnchorElement>
    >(({ onClick, ...props }, ref) => (
      <a
        ref={ref}
        {...props}
        onClick={(event) => {
          onClick?.(event);
          event.preventDefault();
          followed.push(props.href ?? "");
        }}
      />
    ));
    render(<Harness opts={options()} linkComponent={Link} />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(followed).toEqual(["/stations/1"]);
  });

  it("shows its empty content, with no listbox, when there are no options", () => {
    render(<Harness opts={[]} />);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByText("Nothing matches")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).not.toHaveAttribute("aria-controls");
  });

  it("leaves Escape to its host", async () => {
    const onKeyDown = jest.fn((event: KeyboardEvent) => event.defaultPrevented);
    render(
      <div onKeyDown={(e) => onKeyDown(e.nativeEvent)}>
        <Harness opts={options()} />
      </div>
    );
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.keyboard("{Escape}");
    expect(onKeyDown).toHaveLastReturnedWith(false);
  });

  it("passes typing to the caller", async () => {
    const onInputChange = jest.fn();
    render(
      <Combobox
        options={options()}
        inputValue=""
        onInputChange={onInputChange}
        label="Search"
        statusText=""
      />
    );
    await userEvent.type(screen.getByRole("combobox"), "s");
    expect(onInputChange).toHaveBeenCalledWith("s");
  });
});
