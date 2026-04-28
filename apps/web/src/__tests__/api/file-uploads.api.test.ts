import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthMutation: mockUseAuthMutation,
}));

const { fileUploads } = await import("../../api/file-uploads.api");
const { queryKeys } = await import("../../api/keys");

describe("fileUploads.api", () => {
  beforeEach(() => {
    mockUseAuthMutation.mockReset();
  });

  describe("presign", () => {
    it("mutates POST to /api/file-uploads/presign", () => {
      fileUploads.presign();
      expect(mockUseAuthMutation).toHaveBeenCalledWith(
        expect.objectContaining({ url: "/api/file-uploads/presign" })
      );
    });
  });

  describe("confirm", () => {
    it("mutates POST to /api/file-uploads/confirm", () => {
      fileUploads.confirm();
      expect(mockUseAuthMutation).toHaveBeenCalledWith(
        expect.objectContaining({ url: "/api/file-uploads/confirm" })
      );
    });
  });

  describe("parse", () => {
    it("mutates POST to /api/file-uploads/parse with JSON body", () => {
      fileUploads.parse();
      expect(mockUseAuthMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "/api/file-uploads/parse",
        })
      );
      // No `body` mapper — the JSON body is the raw variables object.
      const config = mockUseAuthMutation.mock.calls[0]?.[0] as {
        body?: unknown;
      };
      expect(config.body).toBeUndefined();
    });
  });
});

describe("queryKeys.fileUploads", () => {
  it("exposes a root key for future use", () => {
    expect(queryKeys.fileUploads.root).toEqual(["fileUploads"]);
  });
});
