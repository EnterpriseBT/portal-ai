import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthMutation: mockUseAuthMutation,
}));

const { microsoftExcel } = await import("../../api/microsoft-excel.api");
const { queryKeys } = await import("../../api/keys");

describe("microsoftExcel.api", () => {
  beforeEach(() => {
    mockUseAuthMutation.mockReset();
  });

  it("authorize → POST /api/connectors/microsoft-excel/authorize", () => {
    microsoftExcel.authorize();
    expect(mockUseAuthMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/connectors/microsoft-excel/authorize",
      })
    );
  });

  it("exposes a microsoftExcel root query key", () => {
    expect(queryKeys.microsoftExcel.root).toEqual(["microsoftExcel"]);
  });
});
