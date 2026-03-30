import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Mock the AWS SDK modules before importing S3Service
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSend = jest.fn<any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetSignedUrl = jest.fn<any>();

jest.unstable_mockModule("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  HeadObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  PutObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  GetObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

jest.unstable_mockModule("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mockGetSignedUrl,
}));

const { S3Service } = await import("../../services/s3.service.js");

// ── Tests ──────────────────────────────────────────────────────────

describe("S3Service", () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockGetSignedUrl.mockReset();
  });

  // ── createPresignedUpload ──────────────────────────────────────

  describe("createPresignedUpload()", () => {
    it("should return a presigned URL", async () => {
      mockGetSignedUrl.mockResolvedValue("https://s3.amazonaws.com/presigned-url");

      const url = await S3Service.createPresignedUpload(
        "uploads/org1/job1/file.csv",
        "text/csv"
      );

      expect(url).toBe("https://s3.amazonaws.com/presigned-url");
    });

    it("should call getSignedUrl with the correct parameters", async () => {
      mockGetSignedUrl.mockResolvedValue("https://example.com");

      await S3Service.createPresignedUpload(
        "uploads/org1/job1/file.csv",
        "text/csv",
        600
      );

      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
      const [_client, command, options] = mockGetSignedUrl.mock.calls[0] as [
        unknown,
        { input: { Bucket: string; Key: string; ContentType: string } },
        { expiresIn: number },
      ];
      expect(command.input.Key).toBe("uploads/org1/job1/file.csv");
      expect(command.input.ContentType).toBe("text/csv");
      expect(options.expiresIn).toBe(600);
    });

    it("should propagate errors from getSignedUrl", async () => {
      mockGetSignedUrl.mockRejectedValue(new Error("AWS credentials missing"));

      await expect(
        S3Service.createPresignedUpload("key", "text/csv")
      ).rejects.toThrow("AWS credentials missing");
    });
  });

  // ── headObject ─────────────────────────────────────────────────

  describe("headObject()", () => {
    it("should return content metadata when object exists", async () => {
      mockSend.mockResolvedValue({
        ContentLength: 2048,
        ContentType: "text/csv",
      });

      const result = await S3Service.headObject("uploads/org1/job1/file.csv");

      expect(result).toEqual({
        contentLength: 2048,
        contentType: "text/csv",
      });
    });

    it("should pass the correct s3Key to HeadObjectCommand", async () => {
      mockSend.mockResolvedValue({
        ContentLength: 100,
        ContentType: "text/csv",
      });

      await S3Service.headObject("uploads/org1/job1/data.csv");

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0] as {
        input: { Key: string };
      };
      expect(command.input.Key).toBe("uploads/org1/job1/data.csv");
    });

    it("should default contentLength to 0 when missing", async () => {
      mockSend.mockResolvedValue({
        ContentLength: undefined,
        ContentType: "text/csv",
      });

      const result = await S3Service.headObject("key");
      expect(result?.contentLength).toBe(0);
    });

    it("should default contentType to application/octet-stream when missing", async () => {
      mockSend.mockResolvedValue({
        ContentLength: 100,
        ContentType: undefined,
      });

      const result = await S3Service.headObject("key");
      expect(result?.contentType).toBe("application/octet-stream");
    });

    it("should return null when object is not found (NotFound error)", async () => {
      const notFoundError = new Error("Not Found");
      notFoundError.name = "NotFound";
      mockSend.mockRejectedValue(notFoundError);

      const result = await S3Service.headObject("nonexistent-key");
      expect(result).toBeNull();
    });

    it("should rethrow non-NotFound errors", async () => {
      mockSend.mockRejectedValue(new Error("Access Denied"));

      await expect(S3Service.headObject("key")).rejects.toThrow("Access Denied");
    });
  });
});
