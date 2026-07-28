import { jest } from "@jest/globals";

import { render, screen, fireEvent } from "./test-utils";
import { PinResultDialog } from "../components/PinResultDialog.component";
import type { ServerError } from "../utils/api.util";

// #285: this dialog closed on submit whether or not the pin succeeded, so a
// failed pin looked identical to a successful one. The suite is the house
// Dialog & Form Test Checklist (CLAUDE.md), which the dialog never met, plus
// the two cases that encode the reported bug.

const baseProps = {
  open: true,
  onClose: jest.fn(),
  onSubmit: jest.fn<(name: string) => void>(),
  isPending: false,
  serverError: null as ServerError | null,
};

const SERVER_ERROR: ServerError = {
  message: "Block type “d3” cannot be pinned",
  code: "PORTAL_RESULT_TYPE_NOT_PINNABLE",
};

// The dialog's own accessible name ("Name this result") also matches /name/i,
// so select the single textbox rather than by label.
const nameField = () => screen.getByRole("textbox");
const submit = () => screen.getByRole("button", { name: /^pin$/i });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("PinResultDialog — rendering", () => {
  it("renders its title and the name field when open", () => {
    render(<PinResultDialog {...baseProps} />);
    expect(screen.getByText("Name this result")).toBeInTheDocument();
    expect(nameField()).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(<PinResultDialog {...baseProps} open={false} />);
    expect(screen.queryByText("Name this result")).not.toBeInTheDocument();
  });

  it("shows the pending state and disables the actions", () => {
    render(<PinResultDialog {...baseProps} isPending />);
    expect(screen.getByRole("button", { name: /pinning/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
  });

  it("marks the name field required", () => {
    render(<PinResultDialog {...baseProps} />);
    expect(nameField()).toBeRequired();
  });
});

describe("PinResultDialog — submission", () => {
  it("submits the typed name on the Pin button", () => {
    render(<PinResultDialog {...baseProps} />);
    fireEvent.change(nameField(), { target: { value: "Q1 revenue" } });
    fireEvent.click(submit());
    expect(baseProps.onSubmit).toHaveBeenCalledWith("Q1 revenue");
  });

  it("submits on Enter in the name field", () => {
    // The dialog was not a <form>, so Enter did nothing at all before.
    // MUI portals the dialog, so it is outside the render container.
    const { baseElement } = render(<PinResultDialog {...baseProps} />);
    fireEvent.change(nameField(), { target: { value: "Via keyboard" } });
    const form = baseElement.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    expect(baseProps.onSubmit).toHaveBeenCalledWith("Via keyboard");
  });

  it("trims the submitted name", () => {
    render(<PinResultDialog {...baseProps} />);
    fireEvent.change(nameField(), { target: { value: "  padded  " } });
    fireEvent.click(submit());
    expect(baseProps.onSubmit).toHaveBeenCalledWith("padded");
  });

  it("calls onClose from Cancel without submitting", () => {
    render(<PinResultDialog {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(baseProps.onClose).toHaveBeenCalled();
    expect(baseProps.onSubmit).not.toHaveBeenCalled();
  });
});

describe("PinResultDialog — validation", () => {
  it("blocks an empty name and shows a field error", () => {
    render(<PinResultDialog {...baseProps} />);
    fireEvent.click(submit());
    expect(baseProps.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });

  it("blocks a whitespace-only name", () => {
    render(<PinResultDialog {...baseProps} />);
    fireEvent.change(nameField(), { target: { value: "   " } });
    fireEvent.click(submit());
    expect(baseProps.onSubmit).not.toHaveBeenCalled();
  });

  it("sets aria-invalid on the field when invalid", () => {
    render(<PinResultDialog {...baseProps} />);
    fireEvent.click(submit());
    expect(nameField()).toHaveAttribute("aria-invalid", "true");
  });

  it("clears the error once a valid name is entered", () => {
    render(<PinResultDialog {...baseProps} />);
    fireEvent.click(submit());
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
    fireEvent.change(nameField(), { target: { value: "Named now" } });
    expect(screen.queryByText(/name is required/i)).not.toBeInTheDocument();
  });
});

describe("PinResultDialog — server errors (#285)", () => {
  it("renders FormAlert with the message and code when a pin fails", () => {
    render(<PinResultDialog {...baseProps} serverError={SERVER_ERROR} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("cannot be pinned");
    expect(alert).toHaveTextContent("PORTAL_RESULT_TYPE_NOT_PINNABLE");
  });

  it("renders no alert when there is no server error", () => {
    render(<PinResultDialog {...baseProps} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stays open and keeps the typed name when a pin fails", () => {
    // The reported bug: the dialog closed as if it had succeeded, so the
    // name was lost and there was nothing to retry from.
    const { rerender } = render(<PinResultDialog {...baseProps} />);
    fireEvent.change(nameField(), { target: { value: "Keep me" } });
    fireEvent.click(submit());

    rerender(<PinResultDialog {...baseProps} serverError={SERVER_ERROR} />);

    expect(screen.getByText("Name this result")).toBeInTheDocument();
    expect(nameField()).toHaveValue("Keep me");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("allows retrying from the still-open dialog", () => {
    const { rerender } = render(<PinResultDialog {...baseProps} />);
    fireEvent.change(nameField(), { target: { value: "Retry me" } });
    fireEvent.click(submit());
    rerender(<PinResultDialog {...baseProps} serverError={SERVER_ERROR} />);

    fireEvent.click(submit());
    expect(baseProps.onSubmit).toHaveBeenLastCalledWith("Retry me");
  });
});
