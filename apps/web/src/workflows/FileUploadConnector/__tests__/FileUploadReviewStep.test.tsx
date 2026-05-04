import { jest } from "@jest/globals";

import { render, screen, within } from "../../../__tests__/test-utils";
import userEvent from "@testing-library/user-event";

import { FileUploadReviewStepUI } from "../FileUploadReviewStep.component";
import type { FileUploadReviewStepUIProps } from "../FileUploadReviewStep.component";
import { POST_INTERPRET_REGIONS } from "../utils/file-upload-fixtures.util";
import type { RegionDraft } from "../../../modules/RegionEditor";

function makeProps(
  overrides: Partial<FileUploadReviewStepUIProps> = {}
): FileUploadReviewStepUIProps {
  return {
    regions: POST_INTERPRET_REGIONS,
    overallConfidence: 0.85,
    onJumpToRegion: jest.fn(),
    onEditBinding: jest.fn(),
    onCommit: jest.fn(),
    onBack: jest.fn(),
    serverError: null,
    ...overrides,
  };
}

describe("FileUploadReviewStepUI — rendering", () => {
  test("renders the Review interpretation heading", () => {
    render(<FileUploadReviewStepUI {...makeProps()} />);
    expect(screen.getByText("Review interpretation")).toBeInTheDocument();
  });

  test("renders one card per bound region", () => {
    render(<FileUploadReviewStepUI {...makeProps()} />);
    const jumpButtons = screen.getAllByRole("button", {
      name: /jump to region/i,
    });
    expect(jumpButtons.length).toBe(POST_INTERPRET_REGIONS.length);
  });

  test("renders Back and Commit buttons", () => {
    render(<FileUploadReviewStepUI {...makeProps()} />);
    expect(
      screen.getByRole("button", { name: /back to regions/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /commit plan/i })
    ).toBeInTheDocument();
  });
});

describe("FileUploadReviewStepUI — navigation", () => {
  test("clicking Back fires onBack", async () => {
    const user = userEvent.setup();
    const onBack = jest.fn();
    render(<FileUploadReviewStepUI {...makeProps({ onBack })} />);
    await user.click(screen.getByRole("button", { name: /back to regions/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test("clicking Commit fires onCommit when enabled", async () => {
    const user = userEvent.setup();
    const onCommit = jest.fn();
    render(<FileUploadReviewStepUI {...makeProps({ onCommit })} />);
    await user.click(screen.getByRole("button", { name: /commit plan/i }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

describe("FileUploadReviewStepUI — commit disabled states", () => {
  test("disables Commit and shows spinner label while isCommitting is true", () => {
    render(<FileUploadReviewStepUI {...makeProps({ isCommitting: true })} />);
    const btn = screen.getByRole("button", { name: /committing/i });
    expect(btn).toBeDisabled();
  });

  test("disables Commit when commitDisabledReason is non-null", () => {
    render(
      <FileUploadReviewStepUI
        {...makeProps({
          commitDisabledReason: "At least one region is unbound.",
        })}
      />
    );
    const btn = screen.getByRole("button", { name: /commit plan/i });
    expect(btn).toBeDisabled();
    expect(
      screen.getByText("At least one region is unbound.")
    ).toBeInTheDocument();
  });

  test("disables Commit when any region carries a blocker warning", () => {
    const blockerRegion: RegionDraft = {
      ...POST_INTERPRET_REGIONS[0],
      warnings: [
        {
          code: "IDENTITY_COLUMN_HAS_BLANKS",
          severity: "blocker",
          message: "Identity column has blanks.",
        },
      ],
    };
    render(
      <FileUploadReviewStepUI {...makeProps({ regions: [blockerRegion] })} />
    );
    const btn = screen.getByRole("button", { name: /commit plan/i });
    expect(btn).toBeDisabled();
  });
});

describe("FileUploadReviewStepUI — interactions", () => {
  test("clicking a region card's Jump button fires onJumpToRegion with the region id", async () => {
    const user = userEvent.setup();
    const onJumpToRegion = jest.fn();
    const region = POST_INTERPRET_REGIONS[0];
    render(
      <FileUploadReviewStepUI
        {...makeProps({ regions: [region], onJumpToRegion })}
      />
    );
    await user.click(screen.getByRole("button", { name: /jump to region/i }));
    expect(onJumpToRegion).toHaveBeenCalledWith(region.id);
  });

  test("clicking a binding chip fires onEditBinding with (regionId, sourceLocator)", async () => {
    const user = userEvent.setup();
    const onEditBinding = jest.fn();
    const region = POST_INTERPRET_REGIONS[0];
    render(
      <FileUploadReviewStepUI
        {...makeProps({ regions: [region], onEditBinding })}
      />
    );
    const firstBinding = region.columnBindings![0];
    const chip = screen.getByText(firstBinding.sourceLocator);
    await user.click(chip);
    expect(onEditBinding).toHaveBeenCalledWith(
      region.id,
      firstBinding.sourceLocator
    );
  });
});

describe("FileUploadReviewStepUI — server error", () => {
  test("renders FormAlert when serverError is provided", () => {
    render(
      <FileUploadReviewStepUI
        {...makeProps({
          serverError: {
            message: "Commit failed — downstream service unavailable.",
            code: "COMMIT_FAILED",
          },
        })}
      />
    );
    const alerts = screen.getAllByRole("alert");
    const formAlert = alerts.find((el) =>
      el.textContent?.includes("Commit failed")
    );
    expect(formAlert).toBeTruthy();
    expect(within(formAlert!).getByText(/COMMIT_FAILED/)).toBeInTheDocument();
  });

  test("does not render FormAlert when serverError is null", () => {
    render(
      <FileUploadReviewStepUI
        {...makeProps({ regions: [POST_INTERPRET_REGIONS[0]] })}
      />
    );
    // POST_INTERPRET_REGIONS[0] has no warnings, so the only possible alert
    // would be from FormAlert — and there is no serverError, so none.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("FileUploadReviewStepUI — identity locked to row position", () => {
  test("does not render the IdentityPanel when identity props are not wired", () => {
    // The container intentionally omits `resolveIdentityLocatorOptions` and
    // `onIdentityUpdate` for file-upload — every region is locked to
    // rowPosition, so there's no identity decision for the user to make.
    render(<FileUploadReviewStepUI {...makeProps()} />);
    expect(screen.queryByText(/Record identity/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No stable identity/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Use position-based ids/i)
    ).not.toBeInTheDocument();
  });

  test("does not surface ROW_POSITION_IDENTITY warning chips", () => {
    // The lock helper strips ROW_POSITION_IDENTITY warnings before regions
    // reach the review step; assert no warning surface displays the code
    // even when other regions carry unrelated warnings.
    const regionWithOtherWarning: RegionDraft = {
      ...POST_INTERPRET_REGIONS[0],
      warnings: [
        {
          code: "MULTIPLE_HEADER_CANDIDATES",
          severity: "warn",
          message: "Multiple rows scored similarly as the header.",
        },
      ],
    };
    render(
      <FileUploadReviewStepUI
        {...makeProps({ regions: [regionWithOtherWarning] })}
      />
    );
    expect(
      screen.queryByText(/ROW_POSITION_IDENTITY/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/falls back to row position/i)
    ).not.toBeInTheDocument();
  });
});
