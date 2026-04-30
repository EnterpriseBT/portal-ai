import { jest } from "@jest/globals";

import "@testing-library/jest-dom";

const { render, screen, fireEvent } = await import("../../../__tests__/test-utils");
const { IdentityPanelUI } = await import("../IdentityPanel.component");

import type {
  LocatorOption,
} from "../utils/identity-locator-options.util";
import type {
  IdentityChange,
  IdentityPanelUIProps,
} from "../IdentityPanel.component";

const baseOptions: LocatorOption[] = [
  { key: "col:0", label: "id", uniqueness: "unique", axis: "column", index: 0 },
  {
    key: "col:1",
    label: "name",
    uniqueness: "non-unique",
    axis: "column",
    index: 1,
  },
  {
    key: "col:2",
    label: "blank",
    uniqueness: "all-blank",
    axis: "column",
    index: 2,
  },
];

function makeProps(
  overrides: Partial<IdentityPanelUIProps> = {}
): IdentityPanelUIProps {
  return {
    regionId: "r1",
    currentSelection: {
      kind: "column",
      selectedKey: "col:0",
      label: "id",
      confidence: 0.85,
      source: "heuristic",
    },
    locatorOptions: baseOptions,
    onIdentityChange: jest.fn() as IdentityPanelUIProps["onIdentityChange"],
    ...overrides,
  };
}

describe("IdentityPanelUI — header line", () => {
  it("renders the current locator's header label", () => {
    render(<IdentityPanelUI {...makeProps()} />);
    // Title row: "Record identity: id"
    expect(screen.getByText(/record identity:\s*id/i)).toBeInTheDocument();
  });

  it("renders a 'Set by you' badge when source is 'user'", () => {
    render(
      <IdentityPanelUI
        {...makeProps({
          currentSelection: {
            kind: "column",
            selectedKey: "col:0",
            label: "id",
            source: "user",
          },
        })}
      />
    );
    expect(screen.getByText(/set by you/i)).toBeInTheDocument();
  });

  it("renders the 'No stable identity' label when the current kind is rowPosition", () => {
    render(
      <IdentityPanelUI
        {...makeProps({
          currentSelection: {
            kind: "rowPosition",
            source: "user",
          },
        })}
      />
    );
    expect(screen.getByText(/no stable identity/i)).toBeInTheDocument();
  });
});

describe("IdentityPanelUI — dropdown", () => {
  it("includes one entry per locator option plus a position-based-ids sentinel", () => {
    render(<IdentityPanelUI {...makeProps()} />);
    fireEvent.mouseDown(screen.getByRole("combobox"));
    // MUI's Select renders the selected value's label both in the input
    // and in the open menu — `getAllByText` accommodates the duplicate.
    expect(screen.getAllByText(/^id\b/).length).toBeGreaterThan(0);
    expect(screen.getByText(/^name\b/)).toBeInTheDocument();
    expect(screen.getByText(/^blank\b/)).toBeInTheDocument();
    expect(screen.getByText(/use position-based ids/i)).toBeInTheDocument();
  });

  it("tags each option by uniqueness", () => {
    render(<IdentityPanelUI {...makeProps()} />);
    fireEvent.mouseDown(screen.getByRole("combobox"));
    // The selected option's label ("id (unique)") appears twice — once in
    // the rendered Select input and once in the open menu — so use
    // getAllByText for the tag whose option happens to be selected.
    expect(screen.getAllByText(/\(unique\)/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/may have duplicates/i)).toBeInTheDocument();
    expect(screen.getByText(/all blank/i)).toBeInTheDocument();
  });
});

describe("IdentityPanelUI — selection callback", () => {
  it("fires onIdentityChange with kind:column when a locator option is picked", () => {
    const onIdentityChange = jest.fn() as IdentityPanelUIProps["onIdentityChange"];
    render(<IdentityPanelUI {...makeProps({ onIdentityChange })} />);
    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText(/^name\b/));
    expect(onIdentityChange).toHaveBeenCalledTimes(1);
    const [regionId, change] = (
      onIdentityChange as unknown as jest.Mock
    ).mock.calls[0] as [string, IdentityChange];
    expect(regionId).toBe("r1");
    expect(change).toEqual({
      kind: "column",
      locator: { axis: "column", index: 1 },
    });
  });

  it("fires onIdentityChange with kind:rowPosition when the sentinel is picked", () => {
    const onIdentityChange = jest.fn() as IdentityPanelUIProps["onIdentityChange"];
    render(<IdentityPanelUI {...makeProps({ onIdentityChange })} />);
    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText(/use position-based ids/i));
    const [regionId, change] = (
      onIdentityChange as unknown as jest.Mock
    ).mock.calls[0] as [string, IdentityChange];
    expect(regionId).toBe("r1");
    expect(change).toEqual({ kind: "rowPosition" });
  });
});

describe("IdentityPanelUI — inline duplicate warning", () => {
  it("shows the warning when the current selection is non-unique", () => {
    render(
      <IdentityPanelUI
        {...makeProps({
          currentSelection: {
            kind: "column",
            selectedKey: "col:1",
            label: "name",
            source: "user",
          },
        })}
      />
    );
    expect(screen.getByText(/duplicate values/i)).toBeInTheDocument();
  });

  it("does not show the warning when the current selection is unique", () => {
    render(<IdentityPanelUI {...makeProps()} />);
    expect(screen.queryByText(/duplicate values/i)).toBeNull();
  });

  it("does not show the warning for the rowPosition sentinel", () => {
    render(
      <IdentityPanelUI
        {...makeProps({
          currentSelection: { kind: "rowPosition", source: "user" },
        })}
      />
    );
    expect(screen.queryByText(/duplicate values/i)).toBeNull();
  });
});
