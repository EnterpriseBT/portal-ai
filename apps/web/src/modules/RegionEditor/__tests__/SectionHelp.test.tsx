import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SectionHelpUI } from "../SectionHelp.component";

describe("SectionHelpUI", () => {
  test("renders a help icon with the given aria-label", () => {
    render(<SectionHelpUI title="Helpful tip" ariaLabel="What is this?" />);
    const trigger = screen.getByLabelText("What is this?");
    expect(trigger).toBeInTheDocument();
  });

  test("does not render the tooltip body until the icon is hovered", () => {
    render(<SectionHelpUI title="Helpful tip" ariaLabel="What is this?" />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.queryByText("Helpful tip")).not.toBeInTheDocument();
  });

  test("shows the tooltip body on hover", async () => {
    render(<SectionHelpUI title="Helpful tip" ariaLabel="What is this?" />);
    const trigger = screen.getByLabelText("What is this?");
    fireEvent.mouseOver(trigger);
    await waitFor(() =>
      expect(screen.getByRole("tooltip")).toBeInTheDocument()
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent("Helpful tip");
  });

  test("accepts rich ReactNode content in the tooltip title", async () => {
    render(
      <SectionHelpUI
        ariaLabel="Explain"
        title={
          <>
            <strong>Bold:</strong> emphasised copy
          </>
        }
      />
    );
    fireEvent.mouseOver(screen.getByLabelText("Explain"));
    await waitFor(() =>
      expect(screen.getByRole("tooltip")).toBeInTheDocument()
    );
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent(/Bold:/);
    expect(tooltip.querySelector("strong")).not.toBeNull();
  });
});
