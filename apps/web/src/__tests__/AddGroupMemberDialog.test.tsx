import { jest } from "@jest/globals";

const { render, screen, expectNoAxeViolations } = await import("./test-utils");
const { AddGroupMemberDialog } =
  await import("../components/AddGroupMemberDialog.component");

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onSearchEntities: async () => [],
  onSearchFieldMappings: async () => [],
  selectedEntityId: null,
  onEntityChange: jest.fn(),
  selectedFieldMappingId: null,
  onFieldMappingChange: jest.fn(),
  isPrimary: false,
  onPrimaryChange: jest.fn(),
  overlap: null,
  overlapLoading: false,
  onAddMember: jest.fn(),
  isAdding: false,
  serverError: null,
};

// The dialog's behavior is covered through EntityGroupDetailView; this pins
// its accessibility on its own (#793).
describe("AddGroupMemberDialog", () => {
  it("renders its title when open", async () => {
    render(<AddGroupMemberDialog {...defaultProps} />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("has no axe violations when open", async () => {
    render(<AddGroupMemberDialog {...defaultProps} />);
    await expectNoAxeViolations(await screen.findByRole("dialog"));
  });

  it("has no axe violations with a server error", async () => {
    render(
      <AddGroupMemberDialog
        {...defaultProps}
        serverError={{ message: "Nope", code: "ENTITY_GROUP_MEMBER_EXISTS" }}
      />
    );
    await expectNoAxeViolations(await screen.findByRole("dialog"));
  });
});
