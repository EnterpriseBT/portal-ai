import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { render } from "../../../__tests__/test-utils";

import { TransformEditorUI } from "../TransformEditor.component";

describe("TransformEditorUI", () => {
  it("renders the textarea + placeholder hint when no value + no probe response", () => {
    render(
      <TransformEditorUI value="" onChange={jest.fn()} lastProbeResponse={null} />
    );
    expect(
      screen.getByRole("textbox", { name: /transform expression/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/enter an expression to preview the transformed records/i)
    ).toBeInTheDocument();
  });

  it("fires onChange when the user types", () => {
    const onChange = jest.fn();
    render(
      <TransformEditorUI value="" onChange={onChange} lastProbeResponse={null} />
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: /transform expression/i }),
      { target: { value: "data.items" } }
    );
    expect(onChange).toHaveBeenCalledWith("data.items");
  });

  it("shows a 'probe first' hint when an expression is set but no response is cached", () => {
    render(
      <TransformEditorUI
        value="data.items"
        onChange={jest.fn()}
        lastProbeResponse={null}
      />
    );
    expect(screen.getByTestId("transform-status")).toHaveTextContent(
      /probe an endpoint first to see a live preview/i
    );
  });

  it("renders the transformed records when expression + response are valid", async () => {
    render(
      <TransformEditorUI
        value="data.items"
        onChange={jest.fn()}
        lastProbeResponse={{ data: { items: [{ id: 1 }, { id: 2 }] } }}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("transform-status")).toHaveTextContent(
        /✓ 2 records/i
      );
    });
    expect(screen.getByTestId("transform-preview-out")).toHaveTextContent(
      /"id": 1/
    );
  });

  it("surfaces parse errors inline", async () => {
    render(
      <TransformEditorUI
        value="data.{ unclosed"
        onChange={jest.fn()}
        lastProbeResponse={{ data: [{ id: 1 }] }}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("transform-status")).toHaveTextContent(
        /✗ Parse error/i
      );
    });
  });

  it("surfaces runtime errors inline", async () => {
    render(
      <TransformEditorUI
        value="$undefinedFn(items)"
        onChange={jest.fn()}
        lastProbeResponse={{ items: [1, 2, 3] }}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("transform-status")).toHaveTextContent(
        /✗ Runtime error/i
      );
    });
  });

  it("disables the textarea and surfaces the hint when disabled is true", () => {
    render(
      <TransformEditorUI
        value=""
        onChange={jest.fn()}
        lastProbeResponse={null}
        disabled
        disabledHint="Clear Records path above to enable the Transform editor."
      />
    );
    expect(
      screen.getByRole("textbox", { name: /transform expression/i })
    ).toBeDisabled();
    expect(
      screen.getByTestId("transform-editor-disabled-hint")
    ).toHaveTextContent(/clear records path above/i);
  });

  it("renders a warning Alert when serverError is provided", () => {
    render(
      <TransformEditorUI
        value="data.items"
        onChange={jest.fn()}
        lastProbeResponse={null}
        serverError={{ kind: "parse", message: "unexpected token" }}
      />
    );
    expect(
      screen.getByText(/last probe: transform parse error/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/unexpected token/i)).toBeInTheDocument();
  });
});
