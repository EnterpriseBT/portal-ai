import "@testing-library/jest-dom";
import { jest } from "@jest/globals";

import { render, screen } from "../../../__tests__/test-utils";

import { ProbeReviewStepUI } from "../ProbeReviewStep.component";
import type { ProbeReviewStepUIProps } from "../ProbeReviewStep.component";
import type { EndpointDraft } from "../ApiEndpointForm.component";
import { EMPTY_PAGINATION_DRAFT } from "../utils/rest-api-validation.util";
import type { SearchResult } from "../../../api/types";

function endpoint(overrides: Partial<EndpointDraft> = {}): EndpointDraft {
  return {
    key: "users",
    label: "Users",
    path: "/users",
    method: "GET",
    recordsPath: "",
    idField: "id",
    bodyTemplate: "",
    pagination: EMPTY_PAGINATION_DRAFT,
    ...overrides,
  };
}

function makeColumnDefinitionSearchStub(): SearchResult {
  return {
    onSearch: jest.fn(async () => []),
    onSearchPending: false,
    onSearchError: null,
    getById: jest.fn(async () => null),
    getByIdPending: false,
    getByIdError: null,
    labelMap: {},
  };
}

function makeProps(
  overrides: Partial<ProbeReviewStepUIProps> = {}
): ProbeReviewStepUIProps {
  return {
    endpoints: [endpoint()],
    stateByKey: { users: { kind: "idle" } },
    rowsByKey: { users: [] },
    errorsByKey: { users: {} },
    onRowChange: jest.fn(),
    onAdoptSuggestion: jest.fn(),
    onAddRow: jest.fn(),
    onRemoveRow: jest.fn(),
    serverError: null,
    columnDefinitionSearch: makeColumnDefinitionSearchStub(),
    ...overrides,
  };
}

describe("ProbeReviewStepUI", () => {
  it("renders one section per configured endpoint", () => {
    render(
      <ProbeReviewStepUI
        {...makeProps({
          endpoints: [
            endpoint({ key: "users", label: "Users" }),
            endpoint({ key: "posts", label: "Posts" }),
          ],
          stateByKey: {
            users: { kind: "idle" },
            posts: { kind: "idle" },
          },
          rowsByKey: { users: [], posts: [] },
          errorsByKey: { users: {}, posts: {} },
        })}
      />
    );
    expect(screen.getByTestId("endpoint-review-users")).toBeInTheDocument();
    expect(screen.getByTestId("endpoint-review-posts")).toBeInTheDocument();
  });

  it("renders the empty hint when no endpoints are configured", () => {
    render(<ProbeReviewStepUI {...makeProps({ endpoints: [] })} />);
    expect(
      screen.getByText(/add at least one endpoint in the previous step/i)
    ).toBeInTheDocument();
  });

  it("surfaces the workflow's serverError via FormAlert", () => {
    render(
      <ProbeReviewStepUI
        {...makeProps({
          serverError: { code: "REST_API_OPERATION_FAILED", message: "boom" },
        })}
      />
    );
    expect(screen.getByText(/REST_API_OPERATION_FAILED/)).toBeInTheDocument();
  });
});
