import { jest } from "@jest/globals";

const { render, screen } = await import("./test-utils");
const { FormAlert } = await import(
  "../components/FormAlert.component"
);

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
        serverError={{ message: "Something went wrong", code: "STATION_NOT_FOUND" }}
      />
    );
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
  });

  it("should render the error code in the alert", () => {
    render(
      <FormAlert
        serverError={{ message: "Duplicate name", code: "ENTITY_TAG_DUPLICATE_NAME" }}
      />
    );
    expect(screen.getByText(/ENTITY_TAG_DUPLICATE_NAME/)).toBeInTheDocument();
  });

  it("should have role='alert' on the rendered element", () => {
    render(
      <FormAlert
        serverError={{ message: "Error", code: "TEST_CODE" }}
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
