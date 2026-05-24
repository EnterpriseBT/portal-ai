import "@testing-library/jest-dom";

import { render, screen } from "../../../__tests__/test-utils";

import { DegradationBannerUI } from "../DegradationBanner.component";

describe("DegradationBannerUI", () => {
  it("renders an info alert when degradation is 'llm-failed'", () => {
    render(<DegradationBannerUI degradation="llm-failed" />);
    expect(
      screen.getByText(/AI suggestions unavailable/i)
    ).toBeInTheDocument();
  });

  it("renders nothing when degradation is 'llm-disabled' (silent — spec)", () => {
    const { container } = render(
      <DegradationBannerUI degradation="llm-disabled" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when degradation is null", () => {
    const { container } = render(<DegradationBannerUI degradation={null} />);
    expect(container.firstChild).toBeNull();
  });
});
