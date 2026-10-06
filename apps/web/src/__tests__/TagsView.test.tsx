/**
 * #689: the Tags page renders Create from its gate (in the header and in the
 * empty state) and each card's Edit/Delete from that tag's capabilities.
 */
import { jest } from "@jest/globals";

const mockTagList = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: { entityTags: { list: mockTagList } },
  queryKeys: { entityTags: { root: ["entityTags"] } },
}));

const { render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { TagsViewUI } = await import("../views/Tags.view");

const listResult = (
  entityTags: Array<{
    id: string;
    name: string;
    capabilities: { read: boolean; write: boolean; delete: boolean };
  }>
) => ({
  data: {
    entityTags: entityTags.map((t) => ({
      organizationId: "org-1",
      color: null,
      description: null,
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...t,
    })),
    total: entityTags.length,
    limit: 20,
    offset: 0,
  },
  isLoading: false,
  isError: false,
  isSuccess: true,
  error: null,
});

const props = {
  onCreateTag: jest.fn(),
  onEditTag: jest.fn(),
  onDeleteTag: jest.fn(),
  createGate: { kind: "allow" } as const,
};

describe("TagsViewUI", () => {
  beforeEach(() => {
    mockTagList.mockReturnValue(
      listResult([
        {
          id: "t1",
          name: "Mine",
          capabilities: { read: true, write: true, delete: true },
        },
        {
          id: "t2",
          name: "Theirs",
          capabilities: { read: true, write: false, delete: false },
        },
      ])
    );
  });

  it("offers Edit and Delete only on the tags the caller may change", () => {
    render(<TagsViewUI {...props} />);
    expect(screen.getAllByRole("button", { name: /^edit$/i })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^delete$/i })).toHaveLength(
      1
    );
    expect(screen.getByText("Theirs")).toBeInTheDocument();
  });

  it("opens Create from an allow gate", async () => {
    const onCreateTag = jest.fn();
    render(<TagsViewUI {...props} onCreateTag={onCreateTag} />);
    await userEvent.click(screen.getByRole("button", { name: "Create Tag" }));
    expect(onCreateTag).toHaveBeenCalledTimes(1);
  });

  it("shows Create disabled with the grant hint for a plausible caller", async () => {
    const onCreateTag = jest.fn();
    render(
      <TagsViewUI
        {...props}
        onCreateTag={onCreateTag}
        createGate={{
          kind: "disable",
          reason: "Ask for access to create tags",
        }}
      />
    );
    const create = screen.getByRole("button", { name: "Create Tag" });
    expect(create).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(create);
    expect(onCreateTag).not.toHaveBeenCalled();
    await userEvent.hover(create);
    expect(
      await screen.findByText("Ask for access to create tags")
    ).toBeInTheDocument();
  });

  it("hides Create everywhere, including the empty state, for a hide gate", () => {
    mockTagList.mockReturnValue(listResult([]));
    render(<TagsViewUI {...props} createGate={{ kind: "hide" }} />);
    expect(screen.getByText("No tags found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Tag" })).toBeNull();
  });

  it("offers Create in the empty state for an allow gate", () => {
    mockTagList.mockReturnValue(listResult([]));
    render(<TagsViewUI {...props} />);
    // Header + empty state.
    expect(screen.getAllByRole("button", { name: "Create Tag" })).toHaveLength(
      2
    );
  });
});
