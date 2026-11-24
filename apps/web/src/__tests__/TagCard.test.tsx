import { jest } from "@jest/globals";
import type { EntityTag } from "@portalai/core/models";

const { expectNoAxeViolations, render, screen, fireEvent } =
  await import("./test-utils");
const { TagCardUI } = await import("../components/TagCard.component");

type Capabilities = { read: boolean; write: boolean; delete: boolean };

// List rows carry the caller's `capabilities` (#688).
const makeTag = (
  overrides: Partial<EntityTag> & { capabilities?: Capabilities } = {}
): EntityTag & { capabilities: Capabilities } => ({
  capabilities: { read: true, write: true, delete: true },
  id: "tag-1",
  organizationId: "org-1",
  name: "Production",
  color: "#EF4444",
  description: "Production environment resources",
  sourcePortalId: null,
  created: 1710000000000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  ...overrides,
});

describe("TagCardUI", () => {
  // #1070: where the tag is used, from the list's include=usage.
  it("shows where the tag is used", () => {
    render(
      <TagCardUI
        tag={{
          ...makeTag(),
          usage: {
            entity: 3,
            station: 0,
            pin: 0,
            connector_instance: 1,
            curated_view: 0,
          },
        }}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.getByTestId("tag-usage")).toHaveTextContent(
      "3 entities · 1 connector"
    );
  });

  // #1071: a tag the agent created in a portal session says so.
  it("marks a tag created in a portal session", async () => {
    render(
      <TagCardUI
        tag={makeTag({ sourcePortalId: "portal-1" })}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.getByText("Created in a portal session")).toBeInTheDocument();
    await expectNoAxeViolations(document.body);
  });

  it("doesn't mark a tag created outside a session", () => {
    render(
      <TagCardUI tag={makeTag()} onEdit={jest.fn()} onDelete={jest.fn()} />
    );
    expect(screen.queryByText("Created in a portal session")).toBeNull();
  });

  it("leaves out the usage line when the list didn't ask for it", () => {
    render(
      <TagCardUI tag={makeTag()} onEdit={jest.fn()} onDelete={jest.fn()} />
    );
    expect(screen.queryByTestId("tag-usage")).toBeNull();
  });

  it("should render tag name", () => {
    render(
      <TagCardUI tag={makeTag()} onEdit={jest.fn()} onDelete={jest.fn()} />
    );
    expect(screen.getByText("Production")).toBeInTheDocument();
  });

  it("should render tag description when present", () => {
    render(
      <TagCardUI tag={makeTag()} onEdit={jest.fn()} onDelete={jest.fn()} />
    );
    expect(
      screen.getByText("Production environment resources")
    ).toBeInTheDocument();
  });

  it("should not render description when null", () => {
    render(
      <TagCardUI
        tag={makeTag({ description: null })}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(
      screen.queryByText("Production environment resources")
    ).not.toBeInTheDocument();
  });

  it("should render color dot when color is set", () => {
    render(
      <TagCardUI tag={makeTag()} onEdit={jest.fn()} onDelete={jest.fn()} />
    );
    expect(screen.getByTestId("tag-color-dot")).toBeInTheDocument();
  });

  it("should not render color dot when color is null", () => {
    render(
      <TagCardUI
        tag={makeTag({ color: null })}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.queryByTestId("tag-color-dot")).not.toBeInTheDocument();
  });

  it("should call onEdit with tag when edit button is clicked", () => {
    const onEdit = jest.fn();
    const tag = makeTag();
    render(<TagCardUI tag={tag} onEdit={onEdit} onDelete={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(tag);
  });

  it("should call onDelete with tag when delete button is clicked", () => {
    const onDelete = jest.fn();
    const tag = makeTag();
    render(<TagCardUI tag={tag} onEdit={jest.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(tag);
  });

  // #689: Edit and Delete follow the tag's own capabilities.
  it("renders no Edit or Delete on a tag the caller can only read", () => {
    render(
      <TagCardUI
        tag={makeTag({
          capabilities: { read: true, write: false, delete: false },
        })}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("renders Edit without Delete when the caller may write but not delete", () => {
    render(
      <TagCardUI
        tag={makeTag({
          capabilities: { read: true, write: true, delete: false },
        })}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <TagCardUI tag={makeTag()} onEdit={jest.fn()} onDelete={jest.fn()} />
    );
    await expectNoAxeViolations(container);
  });
});
