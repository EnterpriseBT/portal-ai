import { jest } from "@jest/globals";

const { render, screen } = await import("./test-utils");
const { PolicyEditorDialogUI } =
  await import("../modules/AccessAuthoring/PolicyEditorDialog.component");

const statement = {
  effect: "allow" as const,
  verb: "read" as const,
  resourceType: "station" as const,
  resourceId: null,
  condition: null,
};
const policy = (kind: "system" | "custom") => ({
  id: "p-1",
  name: "FullAccess",
  kind,
  description: "Everything",
  statements: [statement],
});
const props = {
  open: true,
  onClose: jest.fn(),
  name: "FullAccess",
  onNameChange: jest.fn(),
  description: "Everything",
  onDescriptionChange: jest.fn(),
  onStatementsChange: jest.fn(),
  onSearch: jest.fn(async () => []),
  onSubmit: jest.fn(),
  serverError: null,
};

describe("PolicyEditorDialogUI (#691)", () => {
  it("a system policy opens as a read-only view: text, no inputs, Close only", () => {
    render(<PolicyEditorDialogUI {...props} policy={policy("system")} />);
    expect(screen.queryByRole("textbox", { name: /Name/ })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Description/ })).toBeNull();
    expect(screen.getAllByText("FullAccess").length).toBeGreaterThan(0);
    expect(screen.getByText("Everything")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("#691: a system policy's statements read as text, not disabled controls", () => {
    render(<PolicyEditorDialogUI {...props} policy={policy("system")} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /remove statement/ })
    ).toBeNull();
    const list = screen.getByTestId("policy-statement-list");
    expect(list).toHaveTextContent("allow");
    expect(list).toHaveTextContent("read");
    expect(list).toHaveTextContent("station");
  });

  it("a custom policy opens as an editable form", () => {
    render(<PolicyEditorDialogUI {...props} policy={policy("custom")} />);
    expect(screen.getByRole("textbox", { name: /Name/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});
