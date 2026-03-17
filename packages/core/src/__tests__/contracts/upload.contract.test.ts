import { describe, it, expect } from "@jest/globals";

import {
  PresignFileSchema,
  PresignRequestBodySchema,
  ProcessRequestParamsSchema,
  PresignUploadItemSchema,
  PresignResponsePayloadSchema,
} from "../../contracts/upload.contract.js";

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
