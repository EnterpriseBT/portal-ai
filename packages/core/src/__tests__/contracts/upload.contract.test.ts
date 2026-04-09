import { describe, it, expect } from "@jest/globals";

import {
  PresignFileSchema,
  PresignRequestBodySchema,
  ProcessRequestParamsSchema,
  PresignUploadItemSchema,
  PresignResponsePayloadSchema,
  ConfirmColumnSchema,
} from "../../contracts/upload.contract.js";
import { FileUploadColumnRecommendationSchema } from "../../models/job.model.js";

// ── PresignFileSchema ─────────────────────────────────────────────

describe("PresignFileSchema", () => {
  const validFile = {
    fileName: "contacts.csv",
    contentType: "text/csv",
    sizeBytes: 1024,
  };

  it("should parse a valid file descriptor", () => {
    const result = PresignFileSchema.safeParse(validFile);
    expect(result.success).toBe(true);
  });

  it("should reject missing fileName", () => {
    const result = PresignFileSchema.safeParse({
      contentType: "text/csv",
      sizeBytes: 1024,
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing contentType", () => {
    const result = PresignFileSchema.safeParse({
      fileName: "contacts.csv",
      sizeBytes: 1024,
    });
    expect(result.success).toBe(false);
  });

  it("should reject zero sizeBytes", () => {
    const result = PresignFileSchema.safeParse({
      ...validFile,
      sizeBytes: 0,
    });
    expect(result.success).toBe(false);
  });

  it("should reject negative sizeBytes", () => {
    const result = PresignFileSchema.safeParse({
      ...validFile,
      sizeBytes: -100,
    });
    expect(result.success).toBe(false);
  });
});

// ── PresignRequestBodySchema ──────────────────────────────────────

describe("PresignRequestBodySchema", () => {
  const validBody = {
    organizationId: "org_123",
    connectorDefinitionId: "cdef_csv01",
    files: [
      { fileName: "contacts.csv", contentType: "text/csv", sizeBytes: 1024 },
    ],
  };

  it("should parse a valid request body", () => {
    const result = PresignRequestBodySchema.safeParse(validBody);
    expect(result.success).toBe(true);
  });

  it("should parse body with multiple files", () => {
    const result = PresignRequestBodySchema.safeParse({
      ...validBody,
      files: [
        { fileName: "a.csv", contentType: "text/csv", sizeBytes: 100 },
        { fileName: "b.csv", contentType: "text/csv", sizeBytes: 200 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty files array", () => {
    const result = PresignRequestBodySchema.safeParse({
      ...validBody,
      files: [],
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing organizationId", () => {
    const { organizationId: _, ...rest } = validBody;
    const result = PresignRequestBodySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("should reject missing connectorDefinitionId", () => {
    const { connectorDefinitionId: _, ...rest } = validBody;
    const result = PresignRequestBodySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ── ProcessRequestParamsSchema ────────────────────────────────────

describe("ProcessRequestParamsSchema", () => {
  it("should parse valid params", () => {
    const result = ProcessRequestParamsSchema.safeParse({ jobId: "job_abc" });
    expect(result.success).toBe(true);
  });

  it("should reject missing jobId", () => {
    const result = ProcessRequestParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── FileUploadColumnRecommendationSchema ──────────────────────────

describe("FileUploadColumnRecommendationSchema", () => {
  const validRecommendation = {
    sourceField: "email_address",
    existingColumnDefinitionId: "coldef_email",
    existingColumnDefinitionKey: "email",
    confidence: 0.95,
    sampleValues: ["a@b.com", "c@d.com"],
    format: null,
    isPrimaryKey: false,
    required: true,
    normalizedKey: "email_address",
  };

  it("should accept valid payloads with field-mapping-level fields only", () => {
    const result = FileUploadColumnRecommendationSchema.safeParse(validRecommendation);
    expect(result.success).toBe(true);
  });

  it("should require existingColumnDefinitionId as a non-nullable string", () => {
    const withNull = { ...validRecommendation, existingColumnDefinitionId: null };
    expect(FileUploadColumnRecommendationSchema.safeParse(withNull).success).toBe(false);

    const { existingColumnDefinitionId: _, ...withoutId } = validRecommendation;
    expect(FileUploadColumnRecommendationSchema.safeParse(withoutId).success).toBe(false);
  });

  it("should reject payloads with action field", () => {
    const withAction = { ...validRecommendation, action: "match_existing" };
    const result = FileUploadColumnRecommendationSchema.strict().safeParse(withAction);
    expect(result.success).toBe(false);
  });

  it("should reject payloads with key/label/type fields", () => {
    const withKey = { ...validRecommendation, key: "email" };
    expect(FileUploadColumnRecommendationSchema.strict().safeParse(withKey).success).toBe(false);

    const withLabel = { ...validRecommendation, label: "Email" };
    expect(FileUploadColumnRecommendationSchema.strict().safeParse(withLabel).success).toBe(false);

    const withType = { ...validRecommendation, type: "string" };
    expect(FileUploadColumnRecommendationSchema.strict().safeParse(withType).success).toBe(false);
  });

  it("should accept optional field-mapping fields", () => {
    const full = {
      ...validRecommendation,
      defaultValue: "N/A",
      enumValues: ["a", "b"],
    };
    const result = FileUploadColumnRecommendationSchema.safeParse(full);
    expect(result.success).toBe(true);
  });
});

// ── ConfirmColumnSchema ───────────────────────────────────────────

describe("ConfirmColumnSchema", () => {
  const validColumn = {
    sourceField: "role_id",
    existingColumnDefinitionId: "coldef_integer",
    normalizedKey: "role_id",
    format: null,
    isPrimaryKey: false,
    required: true,
  };

  it("should accept valid payloads with all field-mapping-level fields", () => {
    const result = ConfirmColumnSchema.safeParse(validColumn);
    expect(result.success).toBe(true);
  });

  it("should require existingColumnDefinitionId as a non-nullable string", () => {
    const withNull = { ...validColumn, existingColumnDefinitionId: null };
    expect(ConfirmColumnSchema.safeParse(withNull).success).toBe(false);

    const { existingColumnDefinitionId: _, ...withoutId } = validColumn;
    expect(ConfirmColumnSchema.safeParse(withoutId).success).toBe(false);
  });

  it("should require normalizedKey matching /^[a-z][a-z0-9_]*$/", () => {
    // Missing normalizedKey
    const { normalizedKey: _, ...withoutKey } = validColumn;
    expect(ConfirmColumnSchema.safeParse(withoutKey).success).toBe(false);

    // Invalid normalizedKey
    const withUpperCase = { ...validColumn, normalizedKey: "RoleId" };
    expect(ConfirmColumnSchema.safeParse(withUpperCase).success).toBe(false);

    const withSpecialChars = { ...validColumn, normalizedKey: "role-id" };
    expect(ConfirmColumnSchema.safeParse(withSpecialChars).success).toBe(false);

    // Valid normalizedKey
    const withValid = { ...validColumn, normalizedKey: "role_id_2" };
    expect(ConfirmColumnSchema.safeParse(withValid).success).toBe(true);
  });

  it("should reject payloads with action, key, label, type, validationPattern, validationMessage, canonicalFormat", () => {
    const removedFields = [
      { action: "create_new" },
      { key: "role_id" },
      { label: "Role ID" },
      { type: "number" },
      { validationPattern: "^\\d+$" },
      { validationMessage: "Must be a number" },
      { canonicalFormat: "lowercase" },
    ];

    for (const extra of removedFields) {
      const payload = { ...validColumn, ...extra };
      const result = ConfirmColumnSchema.strict().safeParse(payload);
      expect(result.success).toBe(false);
    }
  });

  it("should parse a reference column with ref fields", () => {
    const result = ConfirmColumnSchema.safeParse({
      ...validColumn,
      refEntityKey: "roles",
      refNormalizedKey: "role_id",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refEntityKey).toBe("roles");
      expect(result.data.refNormalizedKey).toBe("role_id");
    }
  });

  it("should parse with null ref fields", () => {
    const result = ConfirmColumnSchema.safeParse({
      ...validColumn,
      refEntityKey: null,
      refNormalizedKey: null,
    });
    expect(result.success).toBe(true);
  });

  it("should reject when old refColumnKey field is present", () => {
    const result = ConfirmColumnSchema.strict().safeParse({
      ...validColumn,
      refEntityKey: "roles",
      refColumnKey: "id",
    });
    expect(result.success).toBe(false);
  });

  it("should accept optional defaultValue and enumValues", () => {
    const result = ConfirmColumnSchema.safeParse({
      ...validColumn,
      defaultValue: "0",
      enumValues: ["admin", "user"],
    });
    expect(result.success).toBe(true);
  });
});

// ── PresignUploadItemSchema ───────────────────────────────────────

describe("PresignUploadItemSchema", () => {
  it("should parse a valid upload item", () => {
    const result = PresignUploadItemSchema.safeParse({
      fileName: "contacts.csv",
      s3Key: "uploads/org_123/job_abc/contacts.csv",
      presignedUrl: "https://bucket.s3.amazonaws.com/uploads/...",
      expiresIn: 900,
    });
    expect(result.success).toBe(true);
  });
});

// ── PresignResponsePayloadSchema ──────────────────────────────────

describe("PresignResponsePayloadSchema", () => {
  it("should parse a valid response payload", () => {
    const result = PresignResponsePayloadSchema.safeParse({
      jobId: "job_abc",
      uploads: [
        {
          fileName: "contacts.csv",
          s3Key: "uploads/org_123/job_abc/contacts.csv",
          presignedUrl: "https://bucket.s3.amazonaws.com/...",
          expiresIn: 900,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing jobId", () => {
    const result = PresignResponsePayloadSchema.safeParse({
      uploads: [],
    });
    expect(result.success).toBe(false);
  });
});
