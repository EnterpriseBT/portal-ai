import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RecordsPreviewDialogUI } from "../RecordsPreviewDialog.component";
import type { PreviewResult } from "../utils/preview-records.util";

const preview: PreviewResult = {
  columns: [{ key: "email", label: "Email", placeholder: false }],
  rows: [{ email: "ada@example.com" }],
  shape: "1 record × 1 field",
  truncated: false,
  notes: [],
};

// A read-only viewer: Close is its only action, and it never blocks
// dismissal.
describe("RecordsPreviewDialogUI", () => {
  it("renders the entity in the title and the records when open", () => {
    render(
      <RecordsPreviewDialogUI
        open
        onClose={jest.fn()}
        preview={preview}
        entityLabel="Contact"
      />
    );
    expect(screen.getByText("Preview records — Contact")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(
      <RecordsPreviewDialogUI
        open={false}
        onClose={jest.fn()}
        preview={preview}
      />
    );
    expect(screen.queryByText("Preview records")).not.toBeInTheDocument();
  });

  it("renders without records when there's no preview", () => {
    render(<RecordsPreviewDialogUI open onClose={jest.fn()} preview={null} />);
    expect(screen.getByText("Preview records")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("closes on Close and on Escape", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<RecordsPreviewDialogUI open onClose={onClose} preview={preview} />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("notes when the records shown are truncated", () => {
    render(
      <RecordsPreviewDialogUI
        open
        onClose={jest.fn()}
        preview={{ ...preview, truncated: true }}
      />
    );
    expect(
      screen.getByText(/showing the first 1 records only/i)
    ).toBeInTheDocument();
  });
});
