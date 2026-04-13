import { jest } from "@jest/globals";

const { render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { HelpSearchBar } = await import(
  "../components/HelpSearchBar.component"
);

describe("HelpSearchBar", () => {
  it("renders an input with the default placeholder 'Search help'", () => {
    render(<HelpSearchBar value="" onChange={jest.fn()} />);
    expect(screen.getByPlaceholderText("Search help")).toBeInTheDocument();
  });

  it("supports overriding the placeholder via prop", () => {
    render(
      <HelpSearchBar value="" onChange={jest.fn()} placeholder="Find anything" />
    );
    expect(screen.getByPlaceholderText("Find anything")).toBeInTheDocument();
  });

  it("calls onChange with the new value on every keystroke", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<HelpSearchBar value="" onChange={onChange} />);

    const input = screen.getByPlaceholderText("Search help");
    await user.type(input, "abc");
    // userEvent.type fires onChange per keystroke; controlled input means each
    // call sees the previous value (empty) plus one char.
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenNthCalledWith(1, "a");
    expect(onChange).toHaveBeenNthCalledWith(2, "b");
    expect(onChange).toHaveBeenNthCalledWith(3, "c");
  });

  it("renders the current value passed via props (controlled)", () => {
    render(<HelpSearchBar value="hello" onChange={jest.fn()} />);
    expect(screen.getByDisplayValue("hello")).toBeInTheDocument();
  });

  it("renders a clear button when value is non-empty and clears on click", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<HelpSearchBar value="hello" onChange={onChange} />);

    const clearButton = screen.getByRole("button", { name: "Clear search" });
    expect(clearButton).toBeInTheDocument();

    await user.click(clearButton);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("does not render the clear button when value is empty", () => {
    render(<HelpSearchBar value="" onChange={jest.fn()} />);
    expect(
      screen.queryByRole("button", { name: "Clear search" })
    ).not.toBeInTheDocument();
  });
});
