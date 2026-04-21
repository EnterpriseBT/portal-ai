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

  describe("parse", () => {
    it("mutates POST to /api/file-uploads/parse", () => {
      fileUploads.parse();
      expect(mockUseAuthMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "/api/file-uploads/parse",
        })
      );
    });

    it("maps a File[] variable into FormData with one 'file' entry per file", () => {
      fileUploads.parse();
      const config = mockUseAuthMutation.mock.calls[0]?.[0] as {
        body?: (files: File[]) => unknown;
      };
      expect(typeof config.body).toBe("function");

      const files = [
        new File(["a"], "first.csv", { type: "text/csv" }),
        new File(["b"], "second.xlsx", {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      ];
      const body = config.body?.(files);
      expect(body).toBeInstanceOf(FormData);
      const fd = body as FormData;
      const fileEntries = fd.getAll("file") as File[];
      expect(fileEntries).toHaveLength(2);
      expect(fileEntries[0].name).toBe("first.csv");
      expect(fileEntries[1].name).toBe("second.xlsx");
    });

    it("accepts a single-element array", () => {
      fileUploads.parse();
      const config = mockUseAuthMutation.mock.calls[0]?.[0] as {
        body?: (files: File[]) => unknown;
      };
      const file = new File(["x"], "only.csv", { type: "text/csv" });
      const body = config.body?.([file]);
      expect((body as FormData).getAll("file")).toHaveLength(1);
    });
  });
});

describe("queryKeys.fileUploads", () => {
  it("exposes a root key for future use", () => {
    expect(queryKeys.fileUploads.root).toEqual(["fileUploads"]);
  });
});
