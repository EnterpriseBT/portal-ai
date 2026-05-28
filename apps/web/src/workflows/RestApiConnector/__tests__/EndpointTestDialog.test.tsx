import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

// ── Mocks ───────────────────────────────────────────────────────────
//
// The container reads `sdk.connectorInstances.testConnection(id)` to
// get a mutateAsync handle and an isPending flag. We mock the SDK with
// a configurable stub so individual tests can control resolution.

const mutateAsyncMock = jest.fn<
  (body: { endpointEntityId: string }) => Promise<unknown>
>();
const useTestConnectionMock = jest.fn(() => ({
  mutateAsync: mutateAsyncMock,
  isPending: false,
}));

jest.unstable_mockModule("../../../api/sdk", () => ({
  sdk: {
    connectorInstances: {
      testConnection: useTestConnectionMock,
    },
  },
  queryKeys: {},
}));

const { render, screen, waitFor } = await import("../../../__tests__/test-utils");
const {
  EndpointTestDialog,
  EndpointTestDialogUI,
} = await import("../EndpointTestDialog.component");

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

  it("renders FormAlert + edit-endpoint button on failure", async () => {
    const onEditEndpoint = jest.fn();
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
        onEditEndpoint={onEditEndpoint}
      />
    );
    expect(screen.getByTestId("endpoint-test-failure")).toBeInTheDocument();
    expect(
      screen.getByText(/REST_API_RECORDS_PATH_NOT_ARRAY/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/expected array/i)
    ).toBeInTheDocument();
    const editButton = screen.getByRole("button", { name: /edit endpoint/i });
    await userEvent.click(editButton);
    expect(onEditEndpoint).toHaveBeenCalled();
  });

  it("hides the edit-endpoint link when onEditEndpoint is not provided", () => {
    render(
      <EndpointTestDialogUI
        open
        endpointLabel="Users"
        isPending={false}
        result={{ ok: false, code: "X", message: "y" }}
        serverError={null}
        onClose={jest.fn()}
      />
    );
    expect(
      screen.queryByRole("button", { name: /edit endpoint/i })
    ).not.toBeInTheDocument();
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
