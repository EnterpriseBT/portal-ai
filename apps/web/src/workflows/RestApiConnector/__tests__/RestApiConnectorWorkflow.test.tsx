import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import { render, screen } from "../../../__tests__/test-utils";

import type { SearchResult } from "../../../api/types";
import {
  RestApiConnectorWorkflowUI,
  type RestApiConnectorWorkflowUIProps,
} from "../RestApiConnectorWorkflow.component";
import { EMPTY_CREDENTIALS_DRAFT } from "../utils/rest-api-validation.util";

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
  overrides: Partial<RestApiConnectorWorkflowUIProps> = {}
): RestApiConnectorWorkflowUIProps {
  return {
    open: true,
    onClose: jest.fn(),
    step: 0,
    onStepChange: jest.fn(),
    onCommit: jest.fn(),
    isCommitting: false,
    canAdvance: true,
    name: "Stripe",
    baseUrl: "https://api.example.com",
    authMode: "none",
    credentials: EMPTY_CREDENTIALS_DRAFT,
    endpoints: [],
    onNameChange: jest.fn(),
    onBaseUrlChange: jest.fn(),
    onAuthModeChange: jest.fn(),
    onCredentialsChange: jest.fn(),
    onEndpointsChange: jest.fn(),
    onPreviewEndpoint: jest.fn(async () => ({ body: {}, truncated: false })),
    onSuggestTransform: jest.fn(async () => ({
      expression: "",
      warning: null,
    })),
    columnDefinitionSearch: makeColumnDefinitionSearchStub(),
    onBasicsBlur: jest.fn(),
    columnsByEndpoint: {},
    probeStateByKey: {},
    onReprobe: jest.fn(),
    onColumnRowChange: jest.fn(),
    onAdoptSuggestion: jest.fn(),
    onAddColumnRow: jest.fn(),
    onRemoveColumnRow: jest.fn(),
    basicsErrors: {},
    basicsTouched: {},
    endpointsErrors: {},
    columnErrorsByEndpoint: {},
    serverError: null,
    ...overrides,
  };
}

const nameField = () =>
  screen.getByRole("textbox", { name: /connector name/i });

// #789: the wizard is a form. Enter does what the step's primary button does
// (Next, or Commit on the last step), gated exactly like it, and nothing
// dismisses the wizard while it commits.
describe("RestApiConnectorWorkflowUI — Enter and commit", () => {
  it("advances on Enter when the step can advance", async () => {
    const user = userEvent.setup();
    const onStepChange = jest.fn();
    render(<RestApiConnectorWorkflowUI {...makeProps({ onStepChange })} />);
    await user.type(nameField(), "x{Enter}");
    expect(onStepChange).toHaveBeenCalledWith(1);
  });

  it("does not advance on Enter when the step can't", async () => {
    const user = userEvent.setup();
    const onStepChange = jest.fn();
    render(
      <RestApiConnectorWorkflowUI
        {...makeProps({ onStepChange, canAdvance: false })}
      />
    );
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await user.type(nameField(), "x{Enter}");
    expect(onStepChange).not.toHaveBeenCalled();
  });

  it("commits on Enter from the last step", async () => {
    const user = userEvent.setup();
    const onCommit = jest.fn();
    render(
      <RestApiConnectorWorkflowUI {...makeProps({ step: 3, onCommit })} />
    );
    screen.getByRole("button", { name: "Commit" }).focus();
    await user.keyboard("{Enter}");
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("can't be dismissed while committing", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(
      <RestApiConnectorWorkflowUI
        {...makeProps({ step: 3, onClose, isCommitting: true })}
      />
    );
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("close")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not commit again on Enter while committing", async () => {
    const user = userEvent.setup();
    const onCommit = jest.fn();
    render(
      <RestApiConnectorWorkflowUI
        {...makeProps({ step: 3, onCommit, isCommitting: true })}
      />
    );
    expect(screen.getByRole("button", { name: "Committing…" })).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(onCommit).not.toHaveBeenCalled();
  });

  // The endpoint form is its own form Modal, portaled out of the wizard.
  // React still bubbles its submit to the wizard's form; it must not advance.
  it("does not advance when the nested endpoint form submits", async () => {
    const user = userEvent.setup();
    const onStepChange = jest.fn();
    render(
      <RestApiConnectorWorkflowUI {...makeProps({ step: 1, onStepChange })} />
    );
    await user.click(screen.getByRole("button", { name: /add endpoint/i }));
    const keyField = await screen.findByRole("textbox", {
      name: /entity key/i,
    });
    await user.type(keyField, "users{Enter}");
    expect(onStepChange).not.toHaveBeenCalled();
  });
});
