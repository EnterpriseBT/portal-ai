import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

// ── Mocks ───────────────────────────────────────────────────────────
//
// The container reads `sdk.connectorInstances.testConnection(id)` to
// get a mutateAsync handle and an isPending flag. We mock the SDK with
// a configurable stub so individual tests can control resolution.

const mutateAsyncMock =
  jest.fn<(body: { endpointEntityId: string }) => Promise<unknown>>();
const useTestConnectionMock = jest.fn(() => ({
  mutateAsync: mutateAsyncMock,
  isPending: false,
}));

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    connectorInstances: {
      testConnection: useTestConnectionMock,
    },
  },
  queryKeys: {},
}));

const { render, screen, waitFor } = await import("./test-utils");
const { EndpointTestDialog, EndpointTestDialogUI } =
  await import("../components/EndpointTestDialog.component");

beforeEach(() => {
  mutateAsyncMock.mockReset();
  useTestConnectionMock.mockReset();
  useTestConnectionMock.mockImplementation(() => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }));
});

// ── EndpointTestDialogUI — pure UI ──────────────────────────────────

describe("EndpointTestDialogUI", () => {
  it("renders the spinner when isPending", () => {
    render(
      <EndpointTestDialogUI
        open
        endpointLabel="Users"
        isPending
        result={null}
        serverError={null}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByText(/calling endpoint/i)).toBeInTheDocument();
  });

  it("renders the sample preview on success", () => {
    render(
      <EndpointTestDialogUI
        open
        endpointLabel="Users"
        isPending={false}
        result={{ ok: true, sample: [{ id: 1 }, { id: 2 }] }}
        serverError={null}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByTestId("endpoint-test-success")).toBeInTheDocument();
    expect(screen.getByText(/returned 2 records/i)).toBeInTheDocument();
    // The pre block stringifies the sample.
    const preview = screen.getByLabelText(/sample records/i);
    expect(preview.textContent).toMatch(/"id": 1/);
  });

  it("renders FormAlert with the failure's code and details", () => {
    render(
      <EndpointTestDialogUI
        open
        endpointLabel="Users"
        isPending={false}
        result={{
          ok: false,
          code: "REST_API_RECORDS_PATH_NOT_ARRAY",
          message: "recordsPath resolved to object, expected array",
          details: { observedType: "object" },
        }}
        serverError={null}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByTestId("endpoint-test-failure")).toBeInTheDocument();
    expect(
      screen.getByText(/REST_API_RECORDS_PATH_NOT_ARRAY/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/expected array/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/failure details/i)).toBeInTheDocument();
  });

  it("calls onClose when the Close button is clicked", async () => {
    const onClose = jest.fn();
    render(
      <EndpointTestDialogUI
        open
        endpointLabel="Users"
        isPending={false}
        result={null}
        serverError={null}
        onClose={onClose}
      />
    );
    // Two Close buttons — the Modal's icon (aria-label="close") and the
    // action footer's text button. Pick the footer one explicitly.
    const buttons = screen.getAllByRole("button", { name: /^close$/i });
    const footerClose = buttons.find((b) => b.textContent?.trim() === "Close");
    await userEvent.click(footerClose!);
    expect(onClose).toHaveBeenCalled();
  });
});

// ── EndpointTestDialog — container ──────────────────────────────────

describe("EndpointTestDialog", () => {
  it("fires the testConnection mutation with endpointEntityId on open", async () => {
    mutateAsyncMock.mockResolvedValueOnce({ ok: true, sample: [{ id: 1 }] });

    render(
      <EndpointTestDialog
        open
        instanceId="inst-1"
        endpointEntityId="ent-users"
        endpointLabel="Users"
        onClose={jest.fn()}
      />
    );

    await waitFor(() =>
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        endpointEntityId: "ent-users",
      })
    );
  });

  it("re-fires when endpointEntityId changes", async () => {
    mutateAsyncMock.mockResolvedValue({ ok: true, sample: [] });

    const { rerender } = render(
      <EndpointTestDialog
        open
        instanceId="inst-1"
        endpointEntityId="ent-a"
        endpointLabel="A"
        onClose={jest.fn()}
      />
    );
    await waitFor(() =>
      expect(mutateAsyncMock).toHaveBeenLastCalledWith({
        endpointEntityId: "ent-a",
      })
    );

    rerender(
      <EndpointTestDialog
        open
        instanceId="inst-1"
        endpointEntityId="ent-b"
        endpointLabel="B"
        onClose={jest.fn()}
      />
    );
    await waitFor(() =>
      expect(mutateAsyncMock).toHaveBeenLastCalledWith({
        endpointEntityId: "ent-b",
      })
    );
  });

  // #780: in StrictMode the open effect runs twice and the second call is
  // deduped onto the first's promise, while React Query's observer has
  // dropped that mutation, so the hook's isPending never clears. The dialog
  // must render from the promise, not from isPending.
  it("shows the result even when the mutation's isPending never clears", async () => {
    useTestConnectionMock.mockImplementation(() => ({
      mutateAsync: mutateAsyncMock,
      isPending: true,
    }));
    mutateAsyncMock.mockResolvedValue({ ok: true, sample: [{ id: 1 }] });

    render(
      <EndpointTestDialog
        open
        instanceId="inst-1"
        endpointEntityId="ent-users"
        endpointLabel="Users"
        onClose={jest.fn()}
      />
    );

    expect(
      await screen.findByTestId("endpoint-test-success")
    ).toBeInTheDocument();
    expect(screen.queryByText(/calling endpoint/i)).not.toBeInTheDocument();
  });

  it("ignores an earlier run's result that arrives after a newer run", async () => {
    let resolveA: (v: unknown) => void = () => {};
    mutateAsyncMock
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveA = resolve))
      )
      .mockResolvedValueOnce({ ok: true, sample: [{ id: "b" }] });

    const { rerender } = render(
      <EndpointTestDialog
        open
        instanceId="inst-1"
        endpointEntityId="ent-a"
        endpointLabel="A"
        onClose={jest.fn()}
      />
    );
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1));
    rerender(
      <EndpointTestDialog
        open
        instanceId="inst-1"
        endpointEntityId="ent-b"
        endpointLabel="B"
        onClose={jest.fn()}
      />
    );
    expect(await screen.findByText(/returned 1 record/i)).toBeInTheDocument();

    resolveA({ ok: false, code: "LATE", message: "stale run" });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/stale run/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/sample records/i).textContent).toMatch(/"b"/);
  });

  it("re-runs the test each time it is reopened", async () => {
    mutateAsyncMock.mockResolvedValue({ ok: true, sample: [] });
    const props = {
      instanceId: "inst-1",
      endpointEntityId: "ent-users",
      endpointLabel: "Users",
      onClose: jest.fn(),
    };
    const { rerender } = render(<EndpointTestDialog open {...props} />);
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1));
    rerender(<EndpointTestDialog open={false} {...props} />);
    rerender(<EndpointTestDialog open {...props} />);
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(2));
  });

  it("does not fire the mutation when closed", () => {
    render(
      <EndpointTestDialog
        open={false}
        instanceId="inst-1"
        endpointEntityId="ent-users"
        endpointLabel="Users"
        onClose={jest.fn()}
      />
    );
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });
});
