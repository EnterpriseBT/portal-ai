import "@testing-library/jest-dom";
import { jest } from "@jest/globals";

// Mock the heavy module so the test stays focused on banner logic.
jest.unstable_mockModule("../../../modules/RegionEditor", () => ({
  ReviewStepUI: ({ onCommit }: { onCommit: () => void }) => (
    <button data-testid="commit" onClick={onCommit}>
      Commit
    </button>
  ),
}));

const { render, screen } = await import("../../../__tests__/test-utils");
const { GoogleSheetsReviewStep } = await import(
  "../GoogleSheetsReviewStep.component"
);
type GoogleSheetsReviewStepUIProps = React.ComponentProps<
  typeof GoogleSheetsReviewStep
>;

function makeProps(
  overrides: Partial<GoogleSheetsReviewStepUIProps> = {}
): GoogleSheetsReviewStepUIProps {
  return {
    regions: [],
    onJumpToRegion: jest.fn(),
    onEditBinding: jest.fn(),
    onCommit: jest.fn(),
    onBack: jest.fn(),
    isCommitting: false,
    serverError: null,
    ...overrides,
  } as unknown as GoogleSheetsReviewStepUIProps;
}

describe("GoogleSheetsReviewStep — rowPosition banner", () => {
  it("does not render the banner when no region uses rowPosition identity", () => {
    render(
      <GoogleSheetsReviewStep
        {...makeProps({
          regions: [
            {
              id: "r1",
              proposedLabel: "Forecast",
              identityStrategy: { kind: "column", confidence: 0.9 },
            } as never,
            {
              id: "r2",
              proposedLabel: "Headcount",
              identityStrategy: { kind: "composite", confidence: 0.6 },
            } as never,
          ],
        })}
      />
    );
    // No alert other than what FormAlert/etc would render — and no
    // mention of the "rowPosition" warning text.
    expect(
      screen.queryByText(/positional row IDs/i)
    ).toBeNull();
  });

  it("renders the rowPosition banner and names every affected region", () => {
    render(
      <GoogleSheetsReviewStep
        {...makeProps({
          regions: [
            {
              id: "r1",
              proposedLabel: "Forecast",
              identityStrategy: { kind: "column", confidence: 0.9 },
            } as never,
            {
              id: "r2",
              proposedLabel: "Misc data",
              identityStrategy: { kind: "rowPosition", confidence: 0.3 },
            } as never,
            {
              id: "r3",
              identityStrategy: { kind: "rowPosition", confidence: 0.3 },
            } as never,
          ],
        })}
      />
    );
    const alert = screen.getByText(/positional row IDs/i).closest('[role="status"]');
    expect(alert).toBeTruthy();
    // Banner names the affected regions (label or id fallback).
    expect(screen.getByText(/Misc data/i)).toBeInTheDocument();
    expect(screen.getByText(/r3/i)).toBeInTheDocument();
    // Forecast (column identity) is NOT named.
    const banner = screen.getByText(/positional row IDs/i).closest("div");
    expect(banner?.textContent ?? "").not.toContain("Forecast");
  });

  it("does not block commit even when the banner is present", async () => {
    const onCommit = jest.fn();
    render(
      <GoogleSheetsReviewStep
        {...makeProps({
          onCommit,
          regions: [
            {
              id: "r1",
              identityStrategy: { kind: "rowPosition", confidence: 0.3 },
            } as never,
          ],
        })}
      />
    );
    const commit = screen.getByTestId("commit");
    commit.click();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("includes the 'Add an identifier column' guidance text", () => {
    render(
      <GoogleSheetsReviewStep
        {...makeProps({
          regions: [
            {
              id: "r1",
              identityStrategy: { kind: "rowPosition", confidence: 0.3 },
            } as never,
          ],
        })}
      />
    );
    expect(screen.getByText(/add an identifier column/i)).toBeInTheDocument();
  });
});
