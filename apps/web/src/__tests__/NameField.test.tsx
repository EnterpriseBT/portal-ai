import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";
import { PolicyUpsertRequestSchema } from "@portalai/core/contracts";
import { Modal } from "@portalai/core/ui";

const { render, screen } = await import("./test-utils");
const { NameField } =
  await import("../modules/AccessAuthoring/NameField.component");

const renderInDialog = (value: string) =>
  render(
    <Modal
      open
      onClose={jest.fn()}
      title="Editor"
      actions={<button type="button">Cancel</button>}
    >
      <NameField
        open
        value={value}
        onChange={jest.fn()}
        rule={PolicyUpsertRequestSchema.shape.name}
      />
      <input aria-label="Description" />
    </Modal>
  );

// #789: the editors' name field validates against the contract and shows its
// error once touched, with aria-invalid; leaving it for Cancel isn't touching.
describe("NameField", () => {
  it("marks the field required", () => {
    renderInDialog("");
    expect(screen.getByRole("textbox", { name: /^name/i })).toBeRequired();
  });

  it("shows the contract's error after a blur to another field", async () => {
    const user = userEvent.setup();
    renderInDialog("   ");
    await user.click(screen.getByRole("textbox", { name: /^name/i }));
    await user.click(screen.getByLabelText("Description"));
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^name/i })).toHaveAttribute(
      "aria-invalid",
      "true"
    );
  });

  it("shows no error when focus moves to Cancel", async () => {
    const user = userEvent.setup();
    renderInDialog("");
    await user.click(screen.getByRole("textbox", { name: /^name/i }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Name is required")).not.toBeInTheDocument();
  });

  it("shows no error for a valid name", async () => {
    const user = userEvent.setup();
    renderInDialog("Analysts");
    await user.click(screen.getByRole("textbox", { name: /^name/i }));
    await user.click(screen.getByLabelText("Description"));
    expect(screen.queryByText("Name is required")).not.toBeInTheDocument();
  });
});
