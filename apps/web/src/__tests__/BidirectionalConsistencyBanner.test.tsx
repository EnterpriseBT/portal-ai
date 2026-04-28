import { jest } from "@jest/globals";

// ── Mocks ───────────────────────────────────────────────────────────

const mockValidateBidirectional = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    fieldMappings: {
      validateBidirectional: mockValidateBidirectional,
    },
  },
}));

const { render, screen } = await import("./test-utils");
const { BidirectionalConsistencyBannerUI, BidirectionalConsistencyBanner } =
  await import("../components/BidirectionalConsistencyBanner.component");

// ── Tests ────────────────────────────────────────────────────────────

describe("BidirectionalConsistencyBannerUI", () => {
  it("renders the warning message with source field and counts", () => {
    render(
      <BidirectionalConsistencyBannerUI
        sourceField="related_contacts"
        inconsistentRecordCount={3}
        totalChecked={10}
      />
    );
    expect(screen.getByText(/related_contacts/)).toBeInTheDocument();
    expect(screen.getByText(/3 of 10 records/)).toBeInTheDocument();
    expect(
      screen.getByText(/inconsistent back-references/)
    ).toBeInTheDocument();
  });

  it("uses singular 'record' when totalChecked is 1", () => {
    render(
      <BidirectionalConsistencyBannerUI
        sourceField="tags"
        inconsistentRecordCount={1}
        totalChecked={1}
      />
    );
    expect(screen.getByText(/1 of 1 record\b/)).toBeInTheDocument();
  });
});

describe("BidirectionalConsistencyBanner", () => {
  beforeEach(() => {
    mockValidateBidirectional.mockReturnValue({ data: undefined });
  });

  it("renders nothing when data is not yet loaded", () => {
    mockValidateBidirectional.mockReturnValue({ data: undefined });
    const { container } = render(
      <BidirectionalConsistencyBanner
        fieldMappingId="fm-1"
        sourceField="related_contacts"
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when isConsistent is true", () => {
    mockValidateBidirectional.mockReturnValue({
      data: { isConsistent: true, inconsistentRecordIds: [], totalChecked: 5 },
    });
    const { container } = render(
      <BidirectionalConsistencyBanner
        fieldMappingId="fm-1"
        sourceField="related_contacts"
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when isConsistent is null (no back-reference configured)", () => {
    mockValidateBidirectional.mockReturnValue({
      data: {
        isConsistent: null,
        inconsistentRecordIds: [],
        totalChecked: 0,
        reason: "no-back-reference-configured",
      },
    });
    const { container } = render(
      <BidirectionalConsistencyBanner
        fieldMappingId="fm-1"
        sourceField="related_contacts"
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the warning banner when isConsistent is false", () => {
    mockValidateBidirectional.mockReturnValue({
      data: {
        isConsistent: false,
        inconsistentRecordIds: ["rec-1", "rec-2"],
        totalChecked: 7,
      },
    });
    render(
      <BidirectionalConsistencyBanner
        fieldMappingId="fm-1"
        sourceField="related_contacts"
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/related_contacts/)).toBeInTheDocument();
    expect(screen.getByText(/2 of 7/)).toBeInTheDocument();
  });

  it("passes the fieldMappingId to validateBidirectional", () => {
    render(
      <BidirectionalConsistencyBanner
        fieldMappingId="fm-42"
        sourceField="tags"
      />
    );
    expect(mockValidateBidirectional).toHaveBeenCalledWith("fm-42");
  });
});
