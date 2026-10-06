import { jest } from "@jest/globals";

const { render, screen } = await import("./test-utils");
const { RoleEditorDialogUI } =
  await import("../modules/AccessAuthoring/RoleEditorDialog.component");

const role = (kind: "system" | "custom") => ({
  id: "r-1",
  name: "admin",
  slug: "admin",
  kind,
  policyIds: ["p-1"],
});
const props = {
  open: true,
  onClose: jest.fn(),
  name: "admin",
  onNameChange: jest.fn(),
  policyIds: ["p-1"],
  onPolicyIdsChange: jest.fn(),
  policyOptions: [{ value: "p-1", label: "FullAccess" }],
  onSubmit: jest.fn(),
  serverError: null,
};

describe("RoleEditorDialogUI (#691)", () => {
  it("a system role opens as a read-only view: its name and policies as text", () => {
    render(<RoleEditorDialogUI {...props} role={role("system")} />);
    expect(screen.queryByRole("textbox", { name: /Name/ })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("FullAccess")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("a custom role opens as an editable form", () => {
    render(<RoleEditorDialogUI {...props} role={role("custom")} />);
    expect(screen.getByRole("textbox", { name: /Name/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});
