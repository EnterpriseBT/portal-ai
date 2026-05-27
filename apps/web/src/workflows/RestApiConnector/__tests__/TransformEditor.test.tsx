import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react";

import { render } from "../../../__tests__/test-utils";

import { TransformEditorUI } from "../TransformEditor.component";

describe("TransformEditorUI", () => {
  it("renders the textarea + the inline help caption", () => {
    render(<TransformEditorUI value="" onChange={jest.fn()} />);
    expect(
      screen.getByRole("textbox", { name: /transform expression/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/jsonata expression/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/preview button below/i)
    ).toBeInTheDocument();
  });

  it("renders an example expression as the textarea placeholder", () => {
    render(<TransformEditorUI value="" onChange={jest.fn()} />);
    const textarea = screen.getByRole("textbox", {
      name: /transform expression/i,
    });
    expect(textarea).toHaveAttribute(
      "placeholder",
      expect.stringContaining('data.items.{ "id": id'),
    );
  });

  it("renders a link to the JSONata documentation", () => {
    render(<TransformEditorUI value="" onChange={jest.fn()} />);
    const link = screen.getByTestId("jsonata-docs-link");
    expect(link).toHaveAttribute("href", "https://docs.jsonata.org/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("fires onChange when the user types", () => {
    const onChange = jest.fn();
    render(<TransformEditorUI value="" onChange={onChange} />);
    fireEvent.change(
      screen.getByRole("textbox", { name: /transform expression/i }),
      { target: { value: "data.items" } }
    );
    expect(onChange).toHaveBeenCalledWith("data.items");
  });

  it("renders the current value in the textarea", () => {
    render(
      <TransformEditorUI value="data.items" onChange={jest.fn()} />
    );
    expect(
      screen.getByRole("textbox", { name: /transform expression/i })
    ).toHaveValue("data.items");
  });

  it("renders a warning Alert when serverError is provided", () => {
    render(
      <TransformEditorUI
        value="data.items"
        onChange={jest.fn()}
        serverError={{ kind: "parse", message: "unexpected token" }}
      />
    );
    expect(
      screen.getByText(/last probe: transform parse error/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/unexpected token/i)).toBeInTheDocument();
  });

  it("does not render a serverError Alert when serverError is null", () => {
    render(
      <TransformEditorUI
        value="data.items"
        onChange={jest.fn()}
        serverError={null}
      />
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
