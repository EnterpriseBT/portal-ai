import "@testing-library/jest-dom";
import { waitFor, screen } from "@testing-library/react";

import { render } from "../../../__tests__/test-utils";

import { PreviewPaneUI } from "../PreviewPane.component";
import type { PreviewPaneUIProps } from "../PreviewPane.component";

function makeProps(
  overrides: Partial<PreviewPaneUIProps> = {}
): PreviewPaneUIProps {
  return {
    response: null,
    truncated: false,
    loading: false,
    error: null,
    extractionMode: "recordsPath",
    recordsPath: "",
    transform: "",
    ...overrides,
  };
}

describe("PreviewPaneUI", () => {
  it("shows the idle hint before any preview has run", () => {
    render(<PreviewPaneUI {...makeProps()} />);
    expect(screen.getByTestId("preview-raw")).toHaveTextContent(
      /click preview to fetch/i
    );
  });

  it("renders the formatted JSON body after a successful preview", () => {
    const response = { data: { items: [{ id: 1, name: "Alice" }] } };
    render(<PreviewPaneUI {...makeProps({ response })} />);
    const raw = screen.getByTestId("preview-raw");
    expect(raw).toHaveTextContent(/"data"/);
    expect(raw).toHaveTextContent(/"items"/);
    expect(raw).toHaveTextContent(/Alice/);
  });

  it("shows the loading state when a preview is in flight", () => {
    render(<PreviewPaneUI {...makeProps({ loading: true })} />);
    expect(screen.getByTestId("preview-raw")).toHaveTextContent(/loading/i);
  });

  it("renders an error Alert when the preview SDK call failed", () => {
    render(
      <PreviewPaneUI {...makeProps({ error: "Network unreachable" })} />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/network unreachable/i);
  });

  it("renders a truncation Alert when the upstream body exceeded the cap", () => {
    render(
      <PreviewPaneUI
        {...makeProps({ response: { ok: true }, truncated: true })}
      />
    );
    expect(
      screen.getByText(/preview truncated to ~256 kb/i)
    ).toBeInTheDocument();
  });

  // ── Records-path mode ─────────────────────────────────────────────

  it("extracts the value at the records path and shows the record count", () => {
    const response = {
      data: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    };
    render(
      <PreviewPaneUI
        {...makeProps({ response, recordsPath: "data.items" })}
      />
    );
    expect(screen.getByTestId("preview-extracted")).toHaveTextContent(
      /"id": 1/
    );
    expect(
      screen.getByText(/extracted via "data\.items" — 3 records/i)
    ).toBeInTheDocument();
  });

  it("warns when the records path doesn't resolve on the response", () => {
    const response = { data: { items: [{ id: 1 }] } };
    render(
      <PreviewPaneUI
        {...makeProps({ response, recordsPath: "nope.missing" })}
      />
    );
    expect(
      screen.getByText(/no data at path "nope\.missing"/i)
    ).toBeInTheDocument();
  });

  it("warns when the records path resolves to an empty array", () => {
    const response = { data: { items: [] } };
    render(
      <PreviewPaneUI
        {...makeProps({ response, recordsPath: "data.items" })}
      />
    );
    expect(
      screen.getByText(/records path resolved to an empty value/i)
    ).toBeInTheDocument();
  });

  // ── Transform mode ────────────────────────────────────────────────

  it("renders the JSONata-transformed records when the expression evaluates", async () => {
    const response = {
      data: [
        { id: 1, user: { name: "Ada" } },
        { id: 2, user: { name: "Grace" } },
      ],
    };
    render(
      <PreviewPaneUI
        {...makeProps({
          response,
          extractionMode: "transform",
          transform: 'data.{ "id": id, "name": user.name }',
        })}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("preview-extracted")).toHaveTextContent(
        /"name": "Ada"/
      );
    });
    expect(
      screen.getByText(/transformed output — 2 records/i)
    ).toBeInTheDocument();
  });

  it("warns when the JSONata expression fails to parse", async () => {
    render(
      <PreviewPaneUI
        {...makeProps({
          response: { data: [{ id: 1 }] },
          extractionMode: "transform",
          transform: "data.{ unclosed",
        })}
      />
    );
    await waitFor(() => {
      expect(
        screen.getByText(/transform parse error/i)
      ).toBeInTheDocument();
    });
  });

  it("warns when the JSONata expression throws at runtime", async () => {
    render(
      <PreviewPaneUI
        {...makeProps({
          response: { items: [1, 2, 3] },
          extractionMode: "transform",
          transform: "$undefinedFn(items)",
        })}
      />
    );
    await waitFor(() => {
      expect(
        screen.getByText(/transform runtime error/i)
      ).toBeInTheDocument();
    });
  });

  it("warns when the JSONata expression evaluates to an empty result", async () => {
    render(
      <PreviewPaneUI
        {...makeProps({
          response: { data: [{ active: false }] },
          extractionMode: "transform",
          transform: "data[active = true]",
        })}
      />
    );
    await waitFor(() => {
      expect(
        screen.getByText(/transform produced an empty result/i)
      ).toBeInTheDocument();
    });
  });

  it("shows the transform-idle hint when in transform mode with no expression", () => {
    render(
      <PreviewPaneUI
        {...makeProps({
          response: { ok: true },
          extractionMode: "transform",
          transform: "",
        })}
      />
    );
    expect(screen.getByTestId("preview-extracted")).toHaveTextContent(
      /enter a jsonata expression/i
    );
  });
});
