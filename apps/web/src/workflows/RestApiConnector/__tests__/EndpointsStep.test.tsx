import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import { render, screen } from "../../../__tests__/test-utils";

import { EndpointsStepUI } from "../EndpointsStep.component";
import type {
  EndpointsStepUIProps,
  EndpointRow,
} from "../EndpointsStep.component";

import { EMPTY_PAGINATION_DRAFT } from "../utils/rest-api-validation.util";

const ROW: EndpointRow = {
  key: "users",
  label: "Users",
  path: "/users",
  method: "GET",
  recordsPath: "",
  idField: "id",
  bodyTemplate: "",
  pagination: EMPTY_PAGINATION_DRAFT,
};

function makeProps(
  overrides: Partial<EndpointsStepUIProps> = {}
): EndpointsStepUIProps {
  return {
    endpoints: [ROW],
    onAdd: jest.fn(),
    onEdit: jest.fn(),
    onTest: jest.fn(),
    onRemove: jest.fn(),
    errors: {},
    serverError: null,
    instanceId: undefined,
    ...overrides,
  };
}

describe("EndpointsStepUI — Test button", () => {
  it("renders a Test button next to each endpoint", () => {
    render(<EndpointsStepUI {...makeProps()} />);
    expect(
      screen.getByRole("button", { name: /test endpoint users/i })
    ).toBeInTheDocument();
  });

  it("disables the Test button when the row has no entityId (workflow draft mode)", () => {
    render(<EndpointsStepUI {...makeProps()} />);
    expect(
      screen.getByRole("button", { name: /test endpoint users/i })
    ).toBeDisabled();
  });

  it("disables the Test button when entityId is set but instanceId is not", () => {
    render(
      <EndpointsStepUI
        {...makeProps({
          endpoints: [{ ...ROW, entityId: "ent-users" }],
        })}
      />
    );
    expect(
      screen.getByRole("button", { name: /test endpoint users/i })
    ).toBeDisabled();
  });

  it("enables the Test button when both instanceId and entityId are present", () => {
    render(
      <EndpointsStepUI
        {...makeProps({
          endpoints: [{ ...ROW, entityId: "ent-users" }],
          instanceId: "inst-1",
        })}
      />
    );
    expect(
      screen.getByRole("button", { name: /test endpoint users/i })
    ).toBeEnabled();
  });

  it("calls onTest with the row index when the user clicks the enabled Test button", async () => {
    const onTest = jest.fn();
    render(
      <EndpointsStepUI
        {...makeProps({
          endpoints: [
            { ...ROW, key: "users", entityId: "ent-users" },
            { ...ROW, key: "posts", label: "Posts", entityId: "ent-posts" },
          ],
          instanceId: "inst-1",
          onTest,
        })}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: /test endpoint posts/i })
    );
    expect(onTest).toHaveBeenCalledWith(1);
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
