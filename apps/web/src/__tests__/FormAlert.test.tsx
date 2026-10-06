import { jest } from "@jest/globals";

const { render, screen } = await import("./test-utils");
const { FormAlert } = await import("../components/FormAlert.component");

describe("FormAlert", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render nothing when serverError is null", () => {
    const { container } = render(<FormAlert serverError={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("should render an alert with the error message", () => {
    render(
      <FormAlert
        serverError={{
          message: "Something went wrong",
          code: "STATION_NOT_FOUND",
        }}
      />
    );
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
  });

  it("should render the error code in the alert", () => {
    render(
      <FormAlert
        serverError={{
          message: "Duplicate name",
          code: "ENTITY_TAG_DUPLICATE_NAME",
        }}
      />
    );
    expect(screen.getByText(/ENTITY_TAG_DUPLICATE_NAME/)).toBeInTheDocument();
  });

  it("should have role='alert' on the rendered element", () => {
    render(<FormAlert serverError={{ message: "Error", code: "TEST_CODE" }} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  // #711 (spec case 15): the server's refusal names the permission, so it's
  // the lead, shown once; the generic lead would only repeat it.
  it("shows a permission refusal's own message once, with its code", () => {
    render(
      <FormAlert
        serverError={{
          message: "You don't have permission to manage billing.",
          code: "PERMISSION_DENIED",
        }}
      />
    );
    expect(
      screen.getAllByText(/You don't have permission to manage billing/)
    ).toHaveLength(1);
    expect(
      screen.queryByText(/permission to perform this action/)
    ).not.toBeInTheDocument();
    expect(screen.getByText("(PERMISSION_DENIED)")).toBeInTheDocument();
  });

  it("falls back to the standard lead for a refusal with no message", () => {
    render(
      <FormAlert serverError={{ message: "", code: "PERMISSION_DENIED" }} />
    );
    expect(
      screen.getByText(/You don't have permission to perform this action/)
    ).toBeInTheDocument();
    expect(screen.getByText("(PERMISSION_DENIED)")).toBeInTheDocument();
  });

  it("does not apply the RBAC lead to a non-permission code", () => {
    render(
      <FormAlert
        serverError={{
          message: "Duplicate name",
          code: "ENTITY_TAG_DUPLICATE_NAME",
        }}
      />
    );
    expect(
      screen.queryByText(/You don't have permission/)
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Duplicate name/)).toBeInTheDocument();
  });
});
