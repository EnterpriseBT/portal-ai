import { jest } from "@jest/globals";
import type { EntityTag } from "@portalai/core/models";

const { render, screen, fireEvent } = await import("./test-utils");
const { TagCardUI } = await import("../components/TagCard.component");

const makeTag = (overrides: Partial<EntityTag> = {}): EntityTag => ({
  id: "tag-1",
  organizationId: "org-1",
  name: "Production",
  color: "#EF4444",
  description: "Production environment resources",
  created: 1710000000000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  ...overrides,
});

describe("TagCardUI", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    expect(onEdit).toHaveBeenCalledWith(tag);
  });

  it("should call onDelete with tag when delete button is clicked", () => {
    const onDelete = jest.fn();
    const tag = makeTag();
    render(<TagCardUI tag={tag} onEdit={jest.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    expect(onDelete).toHaveBeenCalledWith(tag);
  });
});
