import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { BasemapUnavailableNoticeUI } from "../BasemapUnavailableNotice.component";

describe("BasemapUnavailableNotice (#910)", () => {
  it("announces that the basemap is unavailable as a status", () => {
    render(<BasemapUnavailableNoticeUI />);
    expect(screen.getByRole("status")).toHaveTextContent("Basemap unavailable");
  });
});
