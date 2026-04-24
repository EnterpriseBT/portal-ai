import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Terminator } from "@portalai/core/contracts";

import {
  TerminatorFormUI,
  type TerminatorFormUIProps,
} from "../TerminatorForm.component";

function setup(overrides: Partial<TerminatorFormUIProps> = {}) {
  const onChange = jest.fn<(t: Terminator) => void>();
  const props: TerminatorFormUIProps = {
    terminator: { kind: "untilBlank", consecutiveBlanks: 2 },
    onChange,
    ...overrides,
  };
  const utils = render(<TerminatorFormUI {...props} />);
  return { ...utils, onChange };
}

describe("TerminatorFormUI", () => {
  it("renders the untilBlank branch when terminator is untilBlank", () => {
    setup();
    expect(
      screen.getByRole("spinbutton", { name: /consecutive blanks/i })
    ).toHaveValue(2);
    expect(
      screen.queryByRole("textbox", { name: /pattern/i })
    ).not.toBeInTheDocument();
  });

  it("renders the matchesPattern branch when terminator is matchesPattern", () => {
    setup({ terminator: { kind: "matchesPattern", pattern: "^END$" } });
    expect(
      screen.getByRole("textbox", { name: /pattern/i })
    ).toHaveValue("^END$");
  });

  it("rejects a consecutiveBlanks value below 1", () => {
    const { onChange } = setup();
    const blanksInput = screen.getByRole("spinbutton", {
      name: /consecutive blanks/i,
    });
    fireEvent.change(blanksInput, { target: { value: "0" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("flags invalid regex patterns via aria-invalid", () => {
    setup({ terminator: { kind: "matchesPattern", pattern: "(" } });
    const patternInput = screen.getByRole("textbox", { name: /pattern/i });
    expect(patternInput).toHaveAttribute("aria-invalid", "true");
  });
});
