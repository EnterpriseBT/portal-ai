/**
 * #751: a dialog's submit reaches the server once per intent, whichever input
 * produced it: a double-click, a double Enter, a click then Enter, or a
 * twice-pressed Confirm. The dialogs are wired to a real `useAuthMutation`
 * (only `fetch` is stubbed), because the guard lives there, not in the
 * dialog: the pure-UI suites pass a jest `onSubmit` and can't see requests.
 *
 * The synchronous cases (two `fireEvent` activations in one tick) model a
 * second input landing inside the render lag, before `isPending` disables
 * the button. Each has a control proving that the race sends twice without
 * the guard, so the test can't pass vacuously.
 */
import { jest } from "@jest/globals";
import React from "react";

import type { CreateStationBody } from "@portalai/core/contracts";

const { render, screen, fireEvent, waitFor, act } =
  await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { useAuthMutation } = await import("../utils/api.util");
const { CreateStationDialog } =
  await import("../components/CreateStationDialog.component");
const { EditFieldMappingDialog } =
  await import("../components/EditFieldMappingDialog.component");

/** Counts writes and holds them pending; every read fails as offline (the
 *  dialogs' own lookups degrade, as in the pure-UI suites). */
const stubFetch = () => {
  const writes: string[] = [];
  global.fetch = jest.fn<typeof fetch>((input, init) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      return Promise.reject(new TypeError("offline in test"));
    }
    writes.push(`${method} ${String(input)}`);
    return new Promise<Response>(() => {});
  });
  return writes;
};

const StationHarness: React.FC<{ dedupeInFlight?: boolean }> = ({
  dedupeInFlight,
}) => {
  const create = useAuthMutation<unknown, CreateStationBody>({
    url: "/api/stations",
    dedupeInFlight,
  });
  return (
    <CreateStationDialog
      open
      onClose={() => {}}
      onSubmit={(body) => create.mutate(body)}
      isPending={create.isPending}
      serverError={null}
    />
  );
};

const fillName = () =>
  fireEvent.change(screen.getByLabelText(/Name/), {
    target: { value: "My Station" },
  });

const createButton = () => screen.getByRole("button", { name: "Create" });

describe("dialog submits reach the server once (#751)", () => {
  it("two clicks inside the render lag send one create", async () => {
    const writes = stubFetch();
    render(<StationHarness />);
    fillName();

    act(() => {
      fireEvent.click(createButton());
      fireEvent.click(createButton());
    });

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes).toEqual(["POST /api/stations"]);
  });

  it("control: without the guard the same race sends twice", async () => {
    const writes = stubFetch();
    render(<StationHarness dedupeInFlight={false} />);
    fillName();

    act(() => {
      fireEvent.click(createButton());
      fireEvent.click(createButton());
    });

    await waitFor(() => expect(writes).toHaveLength(2));
  });

  it("a click then a form submit (Enter) inside the lag send one create", async () => {
    const writes = stubFetch();
    render(<StationHarness />);
    fillName();
    const form = createButton().closest("form")!;

    act(() => {
      fireEvent.click(createButton());
      fireEvent.submit(form);
    });

    await waitFor(() => expect(writes).toHaveLength(1));
  });

  it("control: without the guard, click then Enter sends twice", async () => {
    const writes = stubFetch();
    render(<StationHarness dedupeInFlight={false} />);
    fillName();
    const form = createButton().closest("form")!;

    act(() => {
      fireEvent.click(createButton());
      fireEvent.submit(form);
    });

    await waitFor(() => expect(writes).toHaveLength(2));
  });

  it("a real double Enter sends one create", async () => {
    const writes = stubFetch();
    const user = userEvent.setup();
    render(<StationHarness />);
    // The default button's `formnovalidate` skips native validation in a
    // browser, but jsdom ignores a submitter's formnovalidate and blocks
    // Enter on the form's `required` fields. Mirror the browser.
    createButton().closest("form")!.noValidate = true;
    await user.type(screen.getByLabelText(/Name/), "My Station{Enter}{Enter}");

    await waitFor(() => expect(writes).toHaveLength(1));
  });

  it("a real double-click sends one create", async () => {
    const writes = stubFetch();
    const user = userEvent.setup();
    render(<StationHarness />);
    fillName();
    await user.dblClick(createButton());

    await waitFor(() => expect(writes).toHaveLength(1));
  });

  it("Confirm & Save pressed twice sends one update", async () => {
    const writes = stubFetch();
    const FieldMappingHarness: React.FC = () => {
      const update = useAuthMutation<unknown, Record<string, unknown>>({
        url: "/api/field-mappings/fm-1",
        method: "PATCH",
      });
      return (
        <EditFieldMappingDialog
          open
          onClose={() => {}}
          onSubmit={(body) => update.mutate(body)}
          fieldMapping={{
            sourceField: "user_email",
            normalizedKey: "email",
            isPrimaryKey: false,
            required: true,
            defaultValue: null,
            format: null,
            enumValues: null,
            columnDefinitionId: "cd-1",
            columnDefinitionLabel: "Email Address",
            connectorEntityLabel: "Contacts",
            refNormalizedKey: null,
            refEntityKey: null,
          }}
          onSearchConnectorEntitiesForRefKey={async () => []}
          isPending={update.isPending}
          serverError={null}
          columnDefinitionType="string"
        />
      );
    };
    render(<FieldMappingHarness />);
    fireEvent.change(screen.getByLabelText(/Normalized Key/), {
      target: { value: "new_key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const confirm = await screen.findByRole("button", { name: /Confirm/ });

    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes).toEqual(["PATCH /api/field-mappings/fm-1"]);
  });
});
