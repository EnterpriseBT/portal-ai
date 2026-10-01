import { jest } from "@jest/globals";
import type { SelectOption } from "@portalai/core/ui";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { CuratedViewPickerUI } =
  await import("../components/CuratedViewPicker.component");

const OPTIONS: SelectOption[] = [
  { value: "cv-1", label: "Q3 orders" },
  { value: "cv-2", label: "Active customers" },
];

describe("CuratedViewPickerUI (#674)", () => {
  it("loads options from the injected fetcher", async () => {
    const fetchOptions = jest.fn(async () => OPTIONS);
    render(
      <CuratedViewPickerUI
        selected={[]}
        onChange={jest.fn()}
        fetchOptions={fetchOptions}
      />
    );
    await waitFor(() => expect(fetchOptions).toHaveBeenCalledWith(""));
    fireEvent.mouseDown(screen.getByLabelText("Views"));
    expect(await screen.findByText("Q3 orders")).toBeInTheDocument();
    expect(screen.getByText("Active customers")).toBeInTheDocument();
  });

  it("calls onChange with the picked ids", async () => {
    const onChange = jest.fn();
    render(
      <CuratedViewPickerUI
        selected={[]}
        onChange={onChange}
        fetchOptions={async () => OPTIONS}
      />
    );
    fireEvent.mouseDown(screen.getByLabelText("Views"));
    fireEvent.click(await screen.findByText("Active customers"));
    expect(onChange).toHaveBeenCalledWith(["cv-2"]);
  });

  it("labels a selected id the search didn't return from selectedLabels", async () => {
    render(
      <CuratedViewPickerUI
        selected={["cv-9"]}
        onChange={jest.fn()}
        selectedLabels={{ "cv-9": "Seeded view" }}
        fetchOptions={async () => OPTIONS}
      />
    );
    expect(await screen.findByText("Seeded view")).toBeInTheDocument();
    expect(screen.queryByText("cv-9")).not.toBeInTheDocument();
  });

  it("renders its helper text", () => {
    render(
      <CuratedViewPickerUI
        selected={[]}
        onChange={jest.fn()}
        fetchOptions={async () => []}
        helperText="No views selected"
      />
    );
    expect(screen.getByText("No views selected")).toBeInTheDocument();
  });
});
