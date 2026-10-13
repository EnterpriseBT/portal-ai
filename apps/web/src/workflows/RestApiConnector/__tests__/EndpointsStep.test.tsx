import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import { render, screen } from "../../../__tests__/test-utils";

import { EndpointsStepUI } from "../EndpointsStep.component";
import type { EndpointsStepUIProps } from "../EndpointsStep.component";
import type { EndpointDraft } from "../ApiEndpointForm.component";

import { EMPTY_PAGINATION_DRAFT } from "../utils/rest-api-validation.util";

const ROW: EndpointDraft = {
  key: "users",
  label: "Users",
  path: "/users",
  method: "GET",
  recordsPath: "",
  idField: "id",
  bodyTemplate: "",
  pagination: EMPTY_PAGINATION_DRAFT,
  totalCountParams: "",
  totalCountPath: "",
};

function makeProps(
  overrides: Partial<EndpointsStepUIProps> = {}
): EndpointsStepUIProps {
  return {
    endpoints: [ROW],
    onAdd: jest.fn(),
    onEdit: jest.fn(),
    onRemove: jest.fn(),
    errors: {},
    serverError: null,
    ...overrides,
  };
}

// #780: the create workflow never holds a saved endpoint, so it offers no
// Test button. A saved endpoint is tested from its entity card instead.
describe("EndpointsStepUI — row actions", () => {
  it("renders no Test button", () => {
    render(<EndpointsStepUI {...makeProps()} />);
    expect(
      screen.queryByRole("button", { name: /test endpoint/i })
    ).not.toBeInTheDocument();
  });

  it("calls onEdit with the row index", async () => {
    const onEdit = jest.fn();
    render(
      <EndpointsStepUI
        {...makeProps({
          endpoints: [ROW, { ...ROW, key: "posts", label: "Posts" }],
          onEdit,
        })}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: /edit endpoint posts/i })
    );
    expect(onEdit).toHaveBeenCalledWith(1);
  });

  it("calls onRemove with the row index", async () => {
    const onRemove = jest.fn();
    render(<EndpointsStepUI {...makeProps({ onRemove })} />);
    await userEvent.click(
      screen.getByRole("button", { name: /remove endpoint users/i })
    );
    expect(onRemove).toHaveBeenCalledWith(0);
  });
});

describe("EndpointsStepUI — empty state + add", () => {
  it("renders the empty-state message when there are no endpoints", () => {
    render(<EndpointsStepUI {...makeProps({ endpoints: [] })} />);
    expect(screen.getByText(/no endpoints yet/i)).toBeInTheDocument();
  });

  it("renders the Add endpoint button regardless of list state", async () => {
    const onAdd = jest.fn();
    render(<EndpointsStepUI {...makeProps({ onAdd })} />);
    await userEvent.click(
      screen.getByRole("button", { name: /add endpoint/i })
    );
    expect(onAdd).toHaveBeenCalled();
  });
});

describe("EndpointsStepUI — error surface", () => {
  it("renders the endpoints-list-level error", () => {
    render(
      <EndpointsStepUI
        {...makeProps({
          errors: { endpoints: "Add at least one endpoint before continuing" },
        })}
      />
    );
    expect(screen.getByText(/at least one endpoint/i)).toBeInTheDocument();
  });
});
