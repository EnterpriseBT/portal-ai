import { describe, it, expect } from "@jest/globals";

import { buildS3ClientConfig } from "../../services/s3.service.js";

// The portability seam (#567) is a pure config builder, so it's assertable
// without constructing a client or mocking the AWS SDK: we check that the
// endpoint/path-style keys appear iff UPLOAD_S3_ENDPOINT is set, and that the
// default (AWS-S3) config is byte-identical to today.

describe("buildS3ClientConfig (#567 portability seam)", () => {
  it("uses region-only config when no endpoint is set (AWS-S3 default unchanged)", () => {
    const cfg = buildS3ClientConfig({
      UPLOAD_S3_REGION: "us-east-1",
      UPLOAD_S3_ENDPOINT: "",
      UPLOAD_S3_FORCE_PATH_STYLE: false,
    });

    expect(cfg.region).toBe("us-east-1");
    expect(cfg.requestChecksumCalculation).toBe("WHEN_REQUIRED");
    // No S3-compatible overrides leak in when the endpoint is unset.
    expect("endpoint" in cfg).toBe(false);
    expect("forcePathStyle" in cfg).toBe(false);
  });

  it("adds endpoint + forcePathStyle for an S3-compatible store (MinIO)", () => {
    const cfg = buildS3ClientConfig({
      UPLOAD_S3_REGION: "us-east-1",
      UPLOAD_S3_ENDPOINT: "http://localhost:9000",
      UPLOAD_S3_FORCE_PATH_STYLE: true,
    });

    expect(cfg.endpoint).toBe("http://localhost:9000");
    expect(cfg.forcePathStyle).toBe(true);
    expect(cfg.region).toBe("us-east-1");
    expect(cfg.requestChecksumCalculation).toBe("WHEN_REQUIRED");
  });

  it("honors forcePathStyle=false alongside a set endpoint", () => {
    const cfg = buildS3ClientConfig({
      UPLOAD_S3_REGION: "eu-west-1",
      UPLOAD_S3_ENDPOINT: "https://s3.example.internal",
      UPLOAD_S3_FORCE_PATH_STYLE: false,
    });

    expect(cfg.endpoint).toBe("https://s3.example.internal");
    expect(cfg.forcePathStyle).toBe(false);
  });
});
