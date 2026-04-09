import { jest } from "@jest/globals";

import { render, screen, fireEvent } from "../../../__tests__/test-utils";
import userEvent from "@testing-library/user-event";

import { ReviewStep } from "../ReviewStep.component";

// Types used for test data - inline to avoid `import type` syntax issues with babel
type ConfirmResponsePayload = {
  connectorInstanceId: string;
  connectorInstanceName: string;
  confirmedEntities: Array<{
    connectorEntityId: string;
    entityKey: string;
    entityLabel: string;
    columnDefinitions: Array<{ id: string; key: string; label: string }>;
    fieldMappings: Array<{
      id: string;
      sourceField: string;
      columnDefinitionId: string;
      isPrimaryKey: boolean;
      normalizedKey: string;
    }>;
  }>;
};

type RecommendedColumn = {
  confidence: number;
  existingColumnDefinitionId: string;
  existingColumnDefinitionKey: string;
  sourceField: string;
  isPrimaryKeyCandidate: boolean;
  sampleValues: string[];
  normalizedKey?: string;
  required?: boolean;
  defaultValue?: string | null;
  format?: string | null;
  enumValues?: string[] | null;
  refEntityKey?: string | null;
  refNormalizedKey?: string | null;
};

type RecommendedEntity = {
  connectorEntity: { key: string; label: string };
  sourceFileName: string;
  columns: RecommendedColumn[];
};

type Recommendations = {
  connectorInstance: { name: string; config: Record<string, unknown> };
  entities: RecommendedEntity[];
};

type ReviewStepProps = {
  recommendations: Recommendations;
  onConnectorNameChange: (name: string) => void;
  onConfirm: () => void;
  isConfirming: boolean;
  confirmError: string | null;
  confirmResult: ConfirmResponsePayload | null;
  onDone: () => void;
  onCancel: () => void;
  isCancelling: boolean;
};

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const MOCK_COLUMN_MATCH: RecommendedColumn = {
  confidence: 0.95,
  existingColumnDefinitionId: "col_001",
  existingColumnDefinitionKey: "email",
  sourceField: "Email Address",
  isPrimaryKeyCandidate: true,
  sampleValues: ["alice@example.com", "bob@test.org"],
  normalizedKey: "email_address",
  required: true,
  format: "email",
  enumValues: null,
  defaultValue: null,
};

const MOCK_COLUMN_NEW: RecommendedColumn = {
  confidence: 0.45,
  existingColumnDefinitionId: "col_002",
  existingColumnDefinitionKey: "phone",
  sourceField: "Phone Number",
  isPrimaryKeyCandidate: false,
  sampleValues: ["+1-555-0100"],
  normalizedKey: "phone_number",
  required: false,
  format: null,
  enumValues: null,
  defaultValue: null,
};

const MOCK_ENTITIES: RecommendedEntity[] = [
  {
    connectorEntity: { key: "contacts", label: "Contacts" },
    sourceFileName: "contacts.csv",
    columns: [MOCK_COLUMN_MATCH, MOCK_COLUMN_NEW],
  },
];

const MOCK_RECOMMENDATIONS: Recommendations = {
  connectorInstance: { name: "My CSV Import", config: {} },
  entities: MOCK_ENTITIES,
};

const MOCK_CONFIRM_RESULT: ConfirmResponsePayload = {
  connectorInstanceId: "ci_001",
  connectorInstanceName: "My CSV Import",
  confirmedEntities: [
    {
      connectorEntityId: "ce_001",
      entityKey: "contacts",
      entityLabel: "Contacts",
      columnDefinitions: [
        { id: "cd_001", key: "email", label: "Email" },
        { id: "cd_002", key: "phone", label: "Phone" },
      ],
      fieldMappings: [
        { id: "fm_001", sourceField: "Email Address", columnDefinitionId: "cd_001", isPrimaryKey: true, normalizedKey: "email" },
        { id: "fm_002", sourceField: "Phone Number", columnDefinitionId: "cd_002", isPrimaryKey: false, normalizedKey: "phone" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProps(overrides: Partial<ReviewStepProps> = {}): ReviewStepProps {
  return {
    recommendations: MOCK_RECOMMENDATIONS,
    onConnectorNameChange: jest.fn(),
    onConfirm: jest.fn(),
    isConfirming: false,
    confirmError: null,
    confirmResult: null,
    onDone: jest.fn(),
    onCancel: jest.fn(),
    isCancelling: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReviewStep", () => {
  describe("Review form (before confirmation)", () => {
    it("displays connector instance name in editable input", () => {
      render(<ReviewStep {...makeProps()} />);
      expect(screen.getByDisplayValue("My CSV Import")).toBeInTheDocument();
    });

    it("displays entity list with column counts", () => {
      render(<ReviewStep {...makeProps()} />);
      expect(screen.getByText("Contacts (contacts)")).toBeInTheDocument();
      expect(screen.getByText("Entities: 1")).toBeInTheDocument();
      expect(screen.getByText("Total columns: 2")).toBeInTheDocument();
    });

    it("displays per-entity column details", () => {
      render(<ReviewStep {...makeProps()} />);
      expect(screen.getByText("Email Address")).toBeInTheDocument();
      expect(screen.getByText("Phone Number")).toBeInTheDocument();
    });

    it("shows reference target as 'entity.normalizedKey' when refEntityKey and refNormalizedKey are set", () => {
      const refColumn: RecommendedColumn = {
        confidence: 0.9,
        existingColumnDefinitionId: "col_ref",
        existingColumnDefinitionKey: "role_id",
        sourceField: "role_id",
        isPrimaryKeyCandidate: false,
        sampleValues: [],
        normalizedKey: "role_id",
        refEntityKey: "roles",
        refNormalizedKey: "role_id",
      };

      render(
        <ReviewStep
          {...makeProps({
            recommendations: {
              ...MOCK_RECOMMENDATIONS,
              entities: [
                {
                  connectorEntity: { key: "users", label: "Users" },
                  sourceFileName: "users.csv",
                  columns: [refColumn],
                },
              ],
            },
          })}
        />
      );

      expect(
        screen.getByText("role_id → roles.role_id")
      ).toBeInTheDocument();
    });

    it("shows 'normalizedKey → entity' when only refEntityKey is set", () => {
      const refColumn: RecommendedColumn = {
        confidence: 0.9,
        existingColumnDefinitionId: "col_ref",
        existingColumnDefinitionKey: "role_id",
        sourceField: "role_id",
        isPrimaryKeyCandidate: false,
        sampleValues: [],
        normalizedKey: "role_id",
        refEntityKey: "roles",
        refNormalizedKey: null,
      };

      render(
        <ReviewStep
          {...makeProps({
            recommendations: {
              ...MOCK_RECOMMENDATIONS,
              entities: [
                {
                  connectorEntity: { key: "users", label: "Users" },
                  sourceFileName: "users.csv",
                  columns: [refColumn],
                },
              ],
            },
          })}
        />
      );

      expect(
        screen.getByText("role_id → roles")
      ).toBeInTheDocument();
    });

    it("shows just normalizedKey when no ref fields are set", () => {
      const refColumn: RecommendedColumn = {
        confidence: 0.9,
        existingColumnDefinitionId: "col_ref",
        existingColumnDefinitionKey: "role_id",
        sourceField: "role_id",
        isPrimaryKeyCandidate: false,
        sampleValues: [],
        normalizedKey: "role_id",
      };

      render(
        <ReviewStep
          {...makeProps({
            recommendations: {
              ...MOCK_RECOMMENDATIONS,
              entities: [
                {
                  connectorEntity: { key: "users", label: "Users" },
                  sourceFileName: "users.csv",
                  columns: [refColumn],
                },
              ],
            },
          })}
        />
      );

      // Both sourceField and normalizedKey show "role_id"
      expect(screen.getAllByText("role_id").length).toBeGreaterThanOrEqual(1);
    });

    it("renders Confirm Import button", () => {
      render(<ReviewStep {...makeProps()} />);
      expect(
        screen.getByRole("button", { name: "Confirm Import" }),
      ).toBeInTheDocument();
    });

    it("renders Cancel Import button", () => {
      render(<ReviewStep {...makeProps()} />);
      expect(
        screen.getByRole("button", { name: "Cancel Import" }),
      ).toBeInTheDocument();
    });

    it("triggers onConfirm when Confirm Import is clicked", async () => {
      const user = userEvent.setup();
      const onConfirm = jest.fn();
      render(<ReviewStep {...makeProps({ onConfirm })} />);
      await user.click(screen.getByRole("button", { name: "Confirm Import" }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("triggers onConfirm on form submission (Enter key)", async () => {
      const onConfirm = jest.fn();
      render(<ReviewStep {...makeProps({ onConfirm })} />);
      const form = screen.getByRole("button", { name: "Confirm Import" }).closest("form")!;
      const { fireEvent } = await import("@testing-library/react");
      fireEvent.submit(form);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("triggers onCancel when Cancel Import is clicked", async () => {
      const user = userEvent.setup();
      const onCancel = jest.fn();
      render(<ReviewStep {...makeProps({ onCancel })} />);
      await user.click(
        screen.getByRole("button", { name: "Cancel Import" }),
      );
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("calls onConnectorNameChange when name is edited", async () => {
      const user = userEvent.setup();
      const onConnectorNameChange = jest.fn();
      render(<ReviewStep {...makeProps({ onConnectorNameChange })} />);
      const input = screen.getByDisplayValue("My CSV Import");
      await user.clear(input);
      await user.type(input, "New Name");
      expect(onConnectorNameChange).toHaveBeenCalled();
    });
  });

  describe("Loading state", () => {
    it("shows Confirming... text and disables button during confirmation", () => {
      render(<ReviewStep {...makeProps({ isConfirming: true })} />);
      const confirmBtn = screen.getByRole("button", { name: /Confirming/ });
      expect(confirmBtn).toBeDisabled();
    });

    it("disables Cancel Import button during confirmation", () => {
      render(<ReviewStep {...makeProps({ isConfirming: true })} />);
      expect(
        screen.getByRole("button", { name: "Cancel Import" }),
      ).toBeDisabled();
    });

    it("disables connector name input during confirmation", () => {
      render(<ReviewStep {...makeProps({ isConfirming: true })} />);
      const input = screen.getByDisplayValue("My CSV Import");
      expect(input).toBeDisabled();
    });

    it("shows Cancelling... text during cancellation", () => {
      render(<ReviewStep {...makeProps({ isCancelling: true })} />);
      expect(
        screen.getByRole("button", { name: /Cancelling/ }),
      ).toBeInTheDocument();
    });
  });

  describe("Error state", () => {
    it("displays confirmation error message", () => {
      render(
        <ReviewStep
          {...makeProps({ confirmError: "Transaction timed out" })}
        />,
      );
      expect(screen.getByText("Transaction timed out")).toBeInTheDocument();
    });

    it("still allows retry after error", () => {
      render(
        <ReviewStep
          {...makeProps({ confirmError: "Transaction timed out" })}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Confirm Import" }),
      ).toBeEnabled();
    });
  });

  describe("Completion summary (after confirmation)", () => {
    it("renders success message", () => {
      render(
        <ReviewStep
          {...makeProps({ confirmResult: MOCK_CONFIRM_RESULT })}
        />,
      );
      expect(
        screen.getByText("Import completed successfully!"),
      ).toBeInTheDocument();
    });

    it("displays connector instance name", () => {
      render(
        <ReviewStep
          {...makeProps({ confirmResult: MOCK_CONFIRM_RESULT })}
        />,
      );
      expect(screen.getByText("My CSV Import")).toBeInTheDocument();
    });

    it("displays created entity details", () => {
      render(
        <ReviewStep
          {...makeProps({ confirmResult: MOCK_CONFIRM_RESULT })}
        />,
      );
      expect(screen.getByText("Contacts (contacts)")).toBeInTheDocument();
      expect(screen.getByText("2 columns defined")).toBeInTheDocument();
      expect(
        screen.getByText("2 field mappings created"),
      ).toBeInTheDocument();
    });

    it("renders Done button", () => {
      render(
        <ReviewStep
          {...makeProps({ confirmResult: MOCK_CONFIRM_RESULT })}
        />,
      );
      expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    });

    it("triggers onDone when Done is clicked", async () => {
      const user = userEvent.setup();
      const onDone = jest.fn();
      render(
        <ReviewStep
          {...makeProps({ confirmResult: MOCK_CONFIRM_RESULT, onDone })}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Done" }));
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("does not render Confirm Import button in completion view", () => {
      render(
        <ReviewStep
          {...makeProps({ confirmResult: MOCK_CONFIRM_RESULT })}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Confirm Import" }),
      ).not.toBeInTheDocument();
    });

    it("does not render Cancel Import button in completion view", () => {
      render(
        <ReviewStep
          {...makeProps({ confirmResult: MOCK_CONFIRM_RESULT })}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Cancel Import" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    const emptyNameRecommendations = {
      ...MOCK_RECOMMENDATIONS,
      connectorInstance: { ...MOCK_RECOMMENDATIONS.connectorInstance, name: "" },
    };

    it("should set aria-invalid on connector name field when empty and blurred", () => {
      render(
        <ReviewStep {...makeProps({ recommendations: emptyNameRecommendations })} />,
      );
      const nameInput = screen.getByLabelText(/Name/);
      fireEvent.focus(nameInput);
      fireEvent.blur(nameInput);
      expect(nameInput).toHaveAttribute("aria-invalid", "true");
    });

    it("should have required attribute on connector name field", () => {
      render(
        <ReviewStep {...makeProps()} />,
      );
      const nameInput = screen.getByLabelText(/Name/);
      expect(nameInput).toBeRequired();
    });

    it("should block confirm when connector name is empty", async () => {
      const user = userEvent.setup();
      const onConfirm = jest.fn();
      render(
        <ReviewStep {...makeProps({ recommendations: emptyNameRecommendations, onConfirm })} />,
      );
      await user.click(screen.getByRole("button", { name: "Confirm Import" }));
      expect(onConfirm).not.toHaveBeenCalled();
      expect(screen.getByText("Connector name is required")).toBeInTheDocument();
    });
  });
});
