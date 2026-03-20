import { jest } from "@jest/globals";

import { render, screen } from "../../../__tests__/test-utils";
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
    }>;
  }>;
};

type RecommendedColumn = {
  action: "match_existing" | "create_new";
  confidence: number;
  existingColumnDefinitionId: string | null;
  recommended: {
    key: string;
    label: string;
    type: string;
    required?: boolean;
    format?: string | null;
    enumValues?: string[] | null;
    description?: string | null;
    refEntityKey?: string | null;
    refColumnKey?: string | null;
    refColumnDefinitionId?: string | null;
  };
  sourceField: string;
  isPrimaryKeyCandidate: boolean;
  sampleValues: string[];
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
  action: "match_existing",
  confidence: 0.95,
  existingColumnDefinitionId: "col_001",
  recommended: {
    key: "email",
    label: "Email",
    type: "string",
    required: true,
    format: "email",
    enumValues: null,
    description: "Contact email",
  },
  sourceField: "Email Address",
  isPrimaryKeyCandidate: true,
  sampleValues: ["alice@example.com", "bob@test.org"],
};

const MOCK_COLUMN_NEW: RecommendedColumn = {
  action: "create_new",
  confidence: 0.45,
  existingColumnDefinitionId: null,
  recommended: {
    key: "phone",
    label: "Phone",
    type: "string",
    required: false,
    format: null,
    enumValues: null,
    description: null,
  },
  sourceField: "Phone Number",
  isPrimaryKeyCandidate: false,
  sampleValues: ["+1-555-0100"],
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
        { id: "fm_001", sourceField: "Email Address", columnDefinitionId: "cd_001", isPrimaryKey: true },
        { id: "fm_002", sourceField: "Phone Number", columnDefinitionId: "cd_002", isPrimaryKey: false },
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
      expect(
        screen.getByText("Total columns: 2 (1 matched, 1 new)"),
      ).toBeInTheDocument();
    });

    it("displays per-entity column details with action indicators", () => {
      render(<ReviewStep {...makeProps()} />);
      expect(screen.getByText("Email Address")).toBeInTheDocument();
      expect(screen.getByText("email (string)")).toBeInTheDocument();
      expect(screen.getByText("match")).toBeInTheDocument();
      expect(screen.getByText("Phone Number")).toBeInTheDocument();
      expect(screen.getByText("phone (string)")).toBeInTheDocument();
      expect(screen.getByText("new")).toBeInTheDocument();
    });

    it("shows reference target as 'entity.column' when refEntityKey and refColumnKey are set", () => {
      const refColumn: RecommendedColumn = {
        action: "create_new",
        confidence: 0.9,
        existingColumnDefinitionId: null,
        recommended: {
          key: "role_id",
          label: "Role ID",
          type: "reference",
          refEntityKey: "roles",
          refColumnKey: "id",
        },
        sourceField: "role_id",
        isPrimaryKeyCandidate: false,
        sampleValues: [],
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
        screen.getByText("role_id (reference → roles.id)")
      ).toBeInTheDocument();
    });

    it("shows 'reference → entity' when only refEntityKey is set", () => {
      const refColumn: RecommendedColumn = {
        action: "create_new",
        confidence: 0.9,
        existingColumnDefinitionId: null,
        recommended: {
          key: "role_id",
          label: "Role ID",
          type: "reference",
          refEntityKey: "roles",
          refColumnKey: null,
        },
        sourceField: "role_id",
        isPrimaryKeyCandidate: false,
        sampleValues: [],
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
        screen.getByText("role_id (reference → roles)")
      ).toBeInTheDocument();
    });

    it("shows plain 'reference' when no ref fields are set", () => {
      const refColumn: RecommendedColumn = {
        action: "create_new",
        confidence: 0.9,
        existingColumnDefinitionId: null,
        recommended: {
          key: "role_id",
          label: "Role ID",
          type: "reference",
          refEntityKey: null,
          refColumnKey: null,
        },
        sourceField: "role_id",
        isPrimaryKeyCandidate: false,
        sampleValues: [],
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
        screen.getByText("role_id (reference)")
      ).toBeInTheDocument();
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
});
