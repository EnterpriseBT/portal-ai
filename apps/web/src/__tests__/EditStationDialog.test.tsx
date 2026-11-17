import { jest } from "@jest/globals";
import type { Station } from "@portalai/core/models";

const {
  render,
  screen,
  fireEvent,
  waitFor,
  pressEnter,
  expectNoAxeViolations,
} = await import("./test-utils");
const { EditStationDialog } =
  await import("../components/EditStationDialog.component");

const sampleStation: Station & { enabledToolpacks: string[] } = {
  id: "station-1",
  organizationId: "org-1",
  name: "Sales Analytics",
  description: "Sales data analysis station",
  enabledToolpacks: ["data_query", "statistics"],
  created: 1710000000000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  station: sampleStation,
  onSubmit: jest.fn(),
  isPending: false,
  serverError: null,
};

describe("EditStationDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render 'Edit Station' title", () => {
    render(<EditStationDialog {...defaultProps} />);
    expect(screen.getByText("Edit Station")).toBeInTheDocument();
  });

  it("has no axe violations when open (#793)", async () => {
    render(<EditStationDialog {...defaultProps} />);
    await expectNoAxeViolations(await screen.findByRole("dialog"));
  });

  it("has no axe violations with a server error (#793)", async () => {
    render(
      <EditStationDialog
        {...defaultProps}
        serverError={{ message: "Something went wrong", code: "TEST_ERROR" }}
      />
    );
    await screen.findByText(/Something went wrong/);
    await expectNoAxeViolations(await screen.findByRole("dialog"));
  });

  it("should pre-populate the name field with station name", () => {
    render(<EditStationDialog {...defaultProps} />);
    expect(screen.getByLabelText(/Name/)).toHaveValue("Sales Analytics");
  });

  it("should pre-populate tool packs from station", () => {
    render(<EditStationDialog {...defaultProps} />);
    expect(screen.getByText("Data Query")).toBeInTheDocument();
    expect(screen.getByText("Statistics")).toBeInTheDocument();
  });

  it("should show name required error when name is cleared and submitted", async () => {
    render(<EditStationDialog {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  it("should submit only changed fields when name is updated", async () => {
    const onSubmit = jest.fn();
    render(<EditStationDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Updated Station" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ name: "Updated Station" });
    });
  });

  it("should call onClose without submitting when nothing changed", () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn();
    render(
      <EditStationDialog
        {...defaultProps}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("should show 'Saving...' and disable buttons when pending", () => {
    render(<EditStationDialog {...defaultProps} isPending={true} />);
    expect(screen.getByRole("button", { name: "Saving..." })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });

  it("should display server error message and code", () => {
    render(
      <EditStationDialog
        {...defaultProps}
        serverError={{
          message: "Station name already exists",
          code: "STATION_DUPLICATE_NAME",
        }}
      />
    );
    expect(screen.getByText(/Station name already exists/)).toBeInTheDocument();
    expect(screen.getByText(/STATION_DUPLICATE_NAME/)).toBeInTheDocument();
  });

  it("should call onClose when Cancel is clicked", () => {
    const onClose = jest.fn();
    render(<EditStationDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("should not render content when open is false", () => {
    render(<EditStationDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Edit Station")).not.toBeInTheDocument();
  });

  it("should submit form on Enter key press in text field", async () => {
    const onSubmit = jest.fn();
    render(<EditStationDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Updated Station" },
    });
    await pressEnter(screen.getByLabelText(/Name/));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ name: "Updated Station" });
    });
  });

  it("should show field error on blur when name is empty", async () => {
    render(<EditStationDialog {...defaultProps} />);
    const nameField = screen.getByLabelText(/Name/);
    fireEvent.change(nameField, { target: { value: "" } });
    fireEvent.blur(nameField);
    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });
  });

  it("should set aria-invalid on name field when validation fails", async () => {
    render(<EditStationDialog {...defaultProps} />);
    const nameInput = screen.getByLabelText(/Name/);
    fireEvent.change(nameInput, { target: { value: "" } });
    fireEvent.blur(nameInput);
    await waitFor(() => {
      expect(nameInput).toHaveAttribute("aria-invalid", "true");
    });
  });

  it("should have aria-required on required fields", () => {
    render(<EditStationDialog {...defaultProps} />);
    const nameInput = screen.getByLabelText(/Name/);
    expect(nameInput).toBeRequired();
  });

  // ── Unentitled built-in packs (#284) ───────────────────────────────

  describe("entitlements", () => {
    const entitled = new Set(["data_query", "web_search"]);

    const openPicker = () => {
      // mouseDown alone opens the listbox — a following click would toggle
      // it shut again. Query by placeholder: once open, MUI renders a second
      // /Tool Packs/ match (the floating label).
      fireEvent.mouseDown(screen.getByPlaceholderText("Select tool packs..."));
    };

    it("offers an unentitled built-in as visible, disabled, and reasoned", async () => {
      render(
        <EditStationDialog {...defaultProps} entitledBuiltinSlugs={entitled} />
      );
      openPicker();

      await waitFor(() => {
        expect(screen.getByText("Entity Management")).toBeInTheDocument();
      });
      const option = screen.getByText("Entity Management").closest("li")!;
      expect(option).toHaveAttribute("aria-disabled", "true");
      expect(
        screen.getAllByText("Not included in your plan").length
      ).toBeGreaterThanOrEqual(1);
    });

    it("#690: says which packs the plan leaves out, with a link to plans", () => {
      render(
        <EditStationDialog {...defaultProps} entitledBuiltinSlugs={entitled} />
      );
      expect(
        screen.getByText(/Some tool packs aren't included in your plan/)
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "View plans" })).toHaveAttribute(
        "href",
        expect.stringContaining("/settings")
      );
    });

    it("#690: shows no upgrade note when every built-in is included", () => {
      render(<EditStationDialog {...defaultProps} />);
      expect(
        screen.queryByText(/Some tool packs aren't included in your plan/)
      ).toBeNull();
    });

    it("leaves entitled built-ins selectable", async () => {
      render(
        <EditStationDialog {...defaultProps} entitledBuiltinSlugs={entitled} />
      );
      openPicker();

      await waitFor(() => {
        expect(screen.getByText("Web Search")).toBeInTheDocument();
      });
      const option = screen.getByText("Web Search").closest("li")!;
      expect(option).not.toHaveAttribute("aria-disabled", "true");
    });

    it("keeps an already-attached unentitled pack selected and removable", async () => {
      // The downgrade case: `statistics` is on the station but no longer in
      // the plan. Disabling governs adding, never keeping or removing — a
      // downgrade must not make the station un-editable.
      const onSubmit = jest.fn();
      render(
        <EditStationDialog
          {...defaultProps}
          onSubmit={onSubmit}
          entitledBuiltinSlugs={entitled}
        />
      );

      const chip = screen.getByText("Statistics").closest(".MuiChip-root")!;
      expect(chip).toBeInTheDocument();

      fireEvent.click(chip.querySelector("[data-testid='CancelIcon']")!);
      await waitFor(() => {
        expect(screen.queryByText("Statistics")).not.toBeInTheDocument();
      });
    });
  });
});

// #801: the shared length limits, shown inline like any other field error.
describe("EditStationDialog — length limits (#801)", () => {
  it("shows the name limit on save and doesn't submit", async () => {
    render(<EditStationDialog {...defaultProps} />);
    const name = screen.getByLabelText(/Name/);
    fireEvent.change(name, { target: { value: "a".repeat(121) } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Name must be 120 characters or fewer")
    ).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  // #801 smoke §4.2: a station saved before the limit keeps its name; only a
  // name the user edits is held to it, and an unchanged name isn't sent.
  it("saves other changes to a station whose existing name is longer", async () => {
    const onSubmit = jest.fn();
    render(
      <EditStationDialog
        {...defaultProps}
        station={{ ...sampleStation, name: "L".repeat(500) }}
        onSubmit={onSubmit}
      />
    );
    const chip = screen.getByText("Statistics").closest(".MuiChip-root")!;
    fireEvent.click(chip.querySelector("[data-testid='CancelIcon']")!);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ toolPacks: ["data_query"] })
    );
    expect(
      screen.queryByText("Name must be 120 characters or fewer")
    ).not.toBeInTheDocument();
  });

  it("still holds an edited legacy name to the limit", async () => {
    const onSubmit = jest.fn();
    render(
      <EditStationDialog
        {...defaultProps}
        station={{ ...sampleStation, name: "L".repeat(500) }}
        onSubmit={onSubmit}
      />
    );
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "L".repeat(500) + "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Name must be 120 characters or fewer")
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// #848: every new organization's stations carry a description stating what
// the station is for. An owner who repurposes one has to be able to change it;
// the dialog had no Description field, though the API always took one.
describe("EditStationDialog — description (#848)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("pre-populates the description", () => {
    render(<EditStationDialog {...defaultProps} />);
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Sales data analysis station"
    );
  });

  it("shows an empty field for a station with no description", () => {
    render(
      <EditStationDialog
        {...defaultProps}
        station={{ ...sampleStation, description: null }}
      />
    );
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });

  it("submits only the description when only it changed", async () => {
    const onSubmit = jest.fn();
    render(<EditStationDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "  Quarterly sales reviews  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        description: "Quarterly sales reviews",
      })
    );
  });

  it("clears the description when the field is emptied", async () => {
    const onSubmit = jest.fn();
    render(<EditStationDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ description: "" })
    );
  });

  it("doesn't send an unchanged description with another change", async () => {
    const onSubmit = jest.fn();
    render(<EditStationDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ name: "Renamed" })
    );
  });

  // Code review: the dialog's "original" came from the live prop, so a
  // refetch while it was open made an untouched field read as edited, and
  // saving sent the old text back over someone else's change.
  it("doesn't send a description another editor changed while the dialog was open", async () => {
    const onSubmit = jest.fn();
    const { rerender } = render(
      <EditStationDialog {...defaultProps} onSubmit={onSubmit} />
    );
    rerender(
      <EditStationDialog
        {...defaultProps}
        onSubmit={onSubmit}
        station={{
          ...sampleStation,
          name: "Renamed elsewhere",
          description: "Changed elsewhere",
        }}
      />
    );
    // The field still shows what the dialog opened with, untouched.
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Sales data analysis station"
    );
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Mine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ name: "Mine" })
    );
  });

  it("treats a stored name with surrounding whitespace as unchanged", () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn();
    render(
      <EditStationDialog
        {...defaultProps}
        station={{ ...sampleStation, name: "  Sales Station " }}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("treats a stored description with surrounding whitespace as unchanged", () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn();
    render(
      <EditStationDialog
        {...defaultProps}
        station={{ ...sampleStation, description: "  Sales data \n" }}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("doesn't hold an untouched over-long description with surrounding whitespace to the limit", async () => {
    const onSubmit = jest.fn();
    render(
      <EditStationDialog
        {...defaultProps}
        station={{
          ...sampleStation,
          description: `${"d".repeat(2500)}\n`,
        }}
        onSubmit={onSubmit}
      />
    );
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ name: "Renamed" })
    );
  });

  it("checks the limit on the trimmed text it will send", async () => {
    const onSubmit = jest.fn();
    render(<EditStationDialog {...defaultProps} onSubmit={onSubmit} />);
    const text = "d".repeat(1999);
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: `${text}\n\n` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ description: text })
    );
  });

  it("closes without submitting when a null description is left empty", () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn();
    render(
      <EditStationDialog
        {...defaultProps}
        station={{ ...sampleStation, description: null }}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("holds an edited description to the limit and doesn't submit", async () => {
    render(<EditStationDialog {...defaultProps} />);
    const description = screen.getByLabelText("Description");
    fireEvent.change(description, { target: { value: "d".repeat(2001) } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Description must be 2000 characters or fewer")
    ).toBeInTheDocument();
    expect(description).toHaveAttribute("aria-invalid", "true");
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  it("shows the limit after blur, before any save", async () => {
    render(<EditStationDialog {...defaultProps} />);
    const description = screen.getByLabelText("Description");
    fireEvent.change(description, { target: { value: "d".repeat(2001) } });
    fireEvent.blur(description);
    expect(
      await screen.findByText("Description must be 2000 characters or fewer")
    ).toBeInTheDocument();
  });

  // As with the name (#801): a description stored before the limit isn't
  // sent or checked unless the user edits it.
  it("saves other changes to a station whose stored description is longer", async () => {
    const onSubmit = jest.fn();
    render(
      <EditStationDialog
        {...defaultProps}
        station={{ ...sampleStation, description: "D".repeat(5000) }}
        onSubmit={onSubmit}
      />
    );
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ name: "Renamed" })
    );
  });

  it("has no axe violations with a description error showing", async () => {
    render(<EditStationDialog {...defaultProps} />);
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "d".repeat(2001) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Description must be 2000 characters or fewer");
    await expectNoAxeViolations(await screen.findByRole("dialog"));
  });
});

// #1043: the dialog seeds its form once but compared it against the live
// station. After a refetch behind the open dialog, what another editor had
// changed read as this editor's edit, and a name-only save put it back.
describe("EditStationDialog — another editor's changes while open (#1043)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const instance = (id: string) => ({
    connectorInstanceId: id,
    connectorInstance: { id, name: `Connector ${id}` },
    canRead: true,
  });
  const view = (id: string) => ({
    curatedViewId: id,
    curatedView: { label: `View ${id}` },
    canRead: true,
  });
  const opened = {
    ...sampleStation,
    enabledToolpacks: ["data_query", "statistics"],
    instances: [instance("ci-1"), instance("ci-2")],
    views: [view("cv-1"), view("cv-2")],
  };

  /** Open on `opened`, let the page refetch `after`, then save a new name. */
  const renameAfterRefetch = async (after: typeof opened) => {
    const onSubmit = jest.fn();
    const { rerender } = render(
      <EditStationDialog
        {...defaultProps}
        station={opened}
        onSubmit={onSubmit}
      />
    );
    rerender(
      <EditStationDialog
        {...defaultProps}
        station={after}
        onSubmit={onSubmit}
      />
    );
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Mine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    return onSubmit.mock.calls[0][0];
  };

  it("doesn't put back a tool pack another editor removed", async () => {
    const body = await renameAfterRefetch({
      ...opened,
      enabledToolpacks: ["data_query"],
    });
    expect(body).toEqual({ name: "Mine" });
  });

  it("doesn't re-attach a connector another editor detached", async () => {
    const body = await renameAfterRefetch({
      ...opened,
      instances: [instance("ci-1")],
    });
    expect(body).toEqual({ name: "Mine" });
  });

  it("doesn't re-attach a view another editor detached", async () => {
    const body = await renameAfterRefetch({
      ...opened,
      views: [view("cv-1")],
    });
    expect(body).toEqual({ name: "Mine" });
  });

  it("doesn't detach a connector or view another editor attached", async () => {
    const body = await renameAfterRefetch({
      ...opened,
      instances: [...opened.instances, instance("ci-3")],
      views: [...opened.views, view("cv-3")],
    });
    expect(body).toEqual({ name: "Mine" });
  });

  it("closes without submitting when nothing was edited, whatever changed behind it", () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn();
    const { rerender } = render(
      <EditStationDialog
        {...defaultProps}
        station={opened}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );
    rerender(
      <EditStationDialog
        {...defaultProps}
        station={{
          ...opened,
          enabledToolpacks: ["data_query"],
          instances: [],
          views: [],
        }}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
