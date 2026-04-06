import React from "react";

import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import type { CSVConnectorWorkflowUIProps } from "../CSVConnectorWorkflow.component";
import { CSVConnectorWorkflowUI } from "../CSVConnectorWorkflow.component";
import type {
  Recommendations,
  RecommendedEntity,
  RecommendedColumn,
} from "../utils/upload-workflow.util";
import type { FileUploadProgress } from "../../../utils/file-upload.util";

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const MOCK_FILES = [
  new File([""], "contacts.csv", { type: "text/csv" }),
  new File([""], "products.csv", { type: "text/csv" }),
];

const MOCK_COLUMN_CONTACT: RecommendedColumn = {
  action: "match_existing",
  confidence: 0.95,
  existingColumnDefinitionId: "col_001",
  recommended: {
    key: "email",
    label: "Email",
    type: "string",
    description: "Contact email address",
    validationPattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
    validationMessage: "Must be a valid email address",
    canonicalFormat: null,
  },
  sourceField: "Email Address",
  isPrimaryKeyCandidate: true,
  sampleValues: ["alice@example.com", "bob@test.org", "carol@acme.io"],
  normalizedKey: "email",
  required: true,
  defaultValue: null,
  format: null,
  enumValues: null,
};

const MOCK_COLUMN_NAME: RecommendedColumn = {
  action: "create_new",
  confidence: 0.72,
  existingColumnDefinitionId: null,
  recommended: {
    key: "full_name",
    label: "Full Name",
    type: "string",
    description: null,
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
  },
  sourceField: "Full Name",
  isPrimaryKeyCandidate: false,
  sampleValues: ["Alice Johnson", "Bob Smith", "Carol Williams"],
  normalizedKey: "full_name",
  required: false,
  defaultValue: null,
  format: null,
  enumValues: null,
};

const MOCK_COLUMN_PHONE: RecommendedColumn = {
  action: "create_new",
  confidence: 0.45,
  existingColumnDefinitionId: null,
  recommended: {
    key: "phone",
    label: "Phone",
    type: "string",
    description: null,
    validationPattern: "^\\+?[\\d\\s\\-().]+$",
    validationMessage: "Must be a valid phone number",
    canonicalFormat: null,
  },
  sourceField: "Phone Number",
  isPrimaryKeyCandidate: false,
  sampleValues: ["+1-555-0100", "+1-555-0101"],
  normalizedKey: "phone",
  required: false,
  defaultValue: null,
  format: null,
  enumValues: null,
};

const MOCK_COLUMN_PRODUCT: RecommendedColumn = {
  action: "match_existing",
  confidence: 0.88,
  existingColumnDefinitionId: "col_010",
  recommended: {
    key: "sku",
    label: "SKU",
    type: "string",
    description: "Product SKU identifier",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
  },
  sourceField: "Product SKU",
  isPrimaryKeyCandidate: true,
  sampleValues: ["SKU-001", "SKU-002", "SKU-003"],
  normalizedKey: "sku",
  required: true,
  defaultValue: null,
  format: null,
  enumValues: null,
};

const MOCK_COLUMN_PRICE: RecommendedColumn = {
  action: "create_new",
  confidence: 0.91,
  existingColumnDefinitionId: null,
  recommended: {
    key: "price",
    label: "Price",
    type: "number",
    description: null,
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: "$#,##0.00",
  },
  sourceField: "Unit Price",
  isPrimaryKeyCandidate: false,
  sampleValues: ["19.99", "24.50", "99.00"],
  normalizedKey: "price",
  required: true,
  defaultValue: null,
  format: null,
  enumValues: null,
};

const MOCK_ENTITIES: RecommendedEntity[] = [
  {
    connectorEntity: { key: "contacts", label: "Contacts" },
    sourceFileName: "contacts.csv",
    columns: [MOCK_COLUMN_CONTACT, MOCK_COLUMN_NAME, MOCK_COLUMN_PHONE],
  },
  {
    connectorEntity: { key: "products", label: "Products" },
    sourceFileName: "products.csv",
    columns: [MOCK_COLUMN_PRODUCT, MOCK_COLUMN_PRICE],
  },
];

const MOCK_RECOMMENDATIONS: Recommendations = {
  connectorInstance: {
    name: "My CSV Import",
    config: {},
  },
  entities: MOCK_ENTITIES,
};

const STEP_CONFIGS = [
  { label: "Upload CSV", description: "Select and upload CSV files" },
  { label: "Confirm Entities", description: "Review detected entities" },
  { label: "Map Columns", description: "Map CSV columns to definitions" },
  { label: "Review & Import", description: "Review and confirm import" },
];

function makeFileProgress(
  entries: Array<{ name: string; loaded: number; total: number }>
): Map<string, FileUploadProgress> {
  const map = new Map<string, FileUploadProgress>();
  for (const e of entries) {
    map.set(e.name, {
      fileName: e.name,
      loaded: e.loaded,
      total: e.total,
      percent: Math.round((e.loaded / e.total) * 100),
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Base props factory
// ---------------------------------------------------------------------------

const baseArgs: CSVConnectorWorkflowUIProps = {
  open: true,
  onClose: fn(),
  step: 0,
  stepConfigs: STEP_CONFIGS,
  files: [],
  onFilesChange: fn(),
  uploadPhase: "idle",
  fileProgress: new Map(),
  overallUploadPercent: 0,
  jobProgress: 0,
  jobError: null,
  uploadError: null,
  isProcessing: false,
  connectionStatus: "idle",
  jobStatus: null,
  jobResult: null,
  recommendations: null,
  parseResults: null,
  onUpdateEntity: fn(),
  dbEntities: [],
  isLoadingDbEntities: false,
  onUpdateColumn: fn(),
  onConnectorNameChange: fn(),
  onConfirm: fn(),
  isConfirming: false,
  confirmError: null,
  confirmResult: null,
  onDone: fn(),
  onCancel: fn(),
  isCancelling: false,
  onBack: fn(),
  onNext: fn(),
  backLabel: "Cancel",
  nextLabel: "Upload",
  isBackDisabled: false,
  isNextDisabled: true,
};

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta = {
  title: "Workflows/CSVConnector",
  component: CSVConnectorWorkflowUI,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof CSVConnectorWorkflowUI>;

export default meta;
type Story = StoryObj<typeof meta>;

// ---------------------------------------------------------------------------
// Step 0: Upload CSV
// ---------------------------------------------------------------------------

export const Step0_Idle: Story = {
  name: "Step 0 — Idle (no files)",
  args: { ...baseArgs },
};

export const Step0_FilesSelected: Story = {
  name: "Step 0 — Files selected",
  args: {
    ...baseArgs,
    files: MOCK_FILES,
    nextLabel: "Upload",
    isNextDisabled: false,
  },
};

export const Step0_Uploading: Story = {
  name: "Step 0 — Uploading",
  args: {
    ...baseArgs,
    files: MOCK_FILES,
    uploadPhase: "uploading",
    isProcessing: true,
    fileProgress: makeFileProgress([
      { name: "contacts.csv", loaded: 512000, total: 1024000 },
      { name: "products.csv", loaded: 200000, total: 800000 },
    ]),
    overallUploadPercent: 39,
    nextLabel: "Processing...",
    isNextDisabled: true,
  },
};

export const Step0_Processing: Story = {
  name: "Step 0 — Processing (server-side)",
  args: {
    ...baseArgs,
    files: MOCK_FILES,
    uploadPhase: "done",
    isProcessing: true,
    jobProgress: 55,
    connectionStatus: "connected",
    nextLabel: "Processing...",
    isNextDisabled: true,
  },
};

export const Step0_UploadError: Story = {
  name: "Step 0 — Upload error",
  args: {
    ...baseArgs,
    files: MOCK_FILES,
    uploadPhase: "error",
    uploadError: "S3 upload failed for contacts.csv (status 403)",
    isProcessing: false,
    nextLabel: "Upload",
    isNextDisabled: false,
  },
};

export const Step0_JobError: Story = {
  name: "Step 0 — Job processing error",
  args: {
    ...baseArgs,
    files: MOCK_FILES,
    uploadPhase: "done",
    isProcessing: false,
    jobError: "Failed to parse CSV: invalid encoding detected",
    connectionStatus: "connected",
    nextLabel: "Upload",
    isNextDisabled: false,
  },
};

export const Step0_ConnectionLost: Story = {
  name: "Step 0 — SSE connection lost",
  args: {
    ...baseArgs,
    files: MOCK_FILES,
    uploadPhase: "done",
    isProcessing: true,
    jobProgress: 30,
    connectionStatus: "error",
    nextLabel: "Processing...",
    isNextDisabled: true,
  },
};

// ---------------------------------------------------------------------------
// Step 1: Confirm Entities
// ---------------------------------------------------------------------------

export const Step1_Entities: Story = {
  name: "Step 1 — Confirm Entities",
  args: {
    ...baseArgs,
    step: 1,
    files: MOCK_FILES,
    uploadPhase: "done",
    recommendations: MOCK_RECOMMENDATIONS,
    backLabel: "Back",
    nextLabel: "Next",
    isNextDisabled: false,
  },
};

export const Step1_NoRecommendations: Story = {
  name: "Step 1 — Waiting for recommendations",
  args: {
    ...baseArgs,
    step: 1,
    files: MOCK_FILES,
    uploadPhase: "done",
    recommendations: null,
    backLabel: "Back",
    nextLabel: "Next",
    isNextDisabled: true,
  },
};

// ---------------------------------------------------------------------------
// Step 2: Map Columns
// ---------------------------------------------------------------------------

export const Step2_ColumnMapping: Story = {
  name: "Step 2 — Column Mapping",
  args: {
    ...baseArgs,
    step: 2,
    files: MOCK_FILES,
    uploadPhase: "done",
    recommendations: MOCK_RECOMMENDATIONS,
    backLabel: "Back",
    nextLabel: "Next",
    isNextDisabled: false,
  },
};

// ---------------------------------------------------------------------------
// Step 3: Review & Import
// ---------------------------------------------------------------------------

export const Step3_Review: Story = {
  name: "Step 3 — Review & Import",
  args: {
    ...baseArgs,
    step: 3,
    files: MOCK_FILES,
    uploadPhase: "done",
    recommendations: MOCK_RECOMMENDATIONS,
    backLabel: "Back",
    nextLabel: "Confirm",
    isNextDisabled: false,
  },
};

// ---------------------------------------------------------------------------
// Interactive story
// ---------------------------------------------------------------------------

const InteractiveContent: React.FC = () => {
  const [step, setStep] = React.useState<0 | 1 | 2 | 3>(0);

  const handleNext = () => setStep((s) => Math.min(s + 1, 3) as 0 | 1 | 2 | 3);
  const handleBack = () => setStep((s) => Math.max(s - 1, 0) as 0 | 1 | 2 | 3);

  return (
    <CSVConnectorWorkflowUI
      {...baseArgs}
      step={step}
      files={MOCK_FILES}
      recommendations={MOCK_RECOMMENDATIONS}
      uploadPhase="done"
      onBack={handleBack}
      onNext={handleNext}
      backLabel={step === 0 ? "Cancel" : "Back"}
      nextLabel={step === 3 ? "Confirm" : "Next"}
      isNextDisabled={false}
    />
  );
};

export const Interactive: Story = {
  name: "Interactive — Navigate steps",
  args: { ...baseArgs },
  render: () => <InteractiveContent />,
};
