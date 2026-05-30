import "@testing-library/jest-dom";
import React from "react";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import { render, screen, waitFor } from "../../../__tests__/test-utils";

import {
  ApiEndpointForm,
  EMPTY_DRAFT,
  type EndpointDraft,
} from "../ApiEndpointForm.component";
import { EMPTY_PAGINATION_DRAFT } from "../utils/rest-api-validation.util";

function makeDraft(overrides: Partial<EndpointDraft> = {}): EndpointDraft {
  return {
    ...EMPTY_DRAFT,
    pagination: { ...EMPTY_PAGINATION_DRAFT },
    ...overrides,
  };
}

describe("ApiEndpointForm — bodyTemplate visibility", () => {
  it("hides the body template field when method is GET", () => {
    render(
      <ApiEndpointForm open onSubmit={jest.fn()} onClose={jest.fn()} />
    );
    expect(screen.queryByLabelText(/body template/i)).not.toBeInTheDocument();
  });

  it("shows the body template field when method is switched to POST", async () => {
    render(
      <ApiEndpointForm open onSubmit={jest.fn()} onClose={jest.fn()} />
    );
    await userEvent.click(screen.getByLabelText(/^method/i));
    await userEvent.click(await screen.findByRole("option", { name: /^post$/i }));
    expect(screen.getByLabelText(/body template/i)).toBeInTheDocument();
  });

  it("clears the body template when method flips back to GET", async () => {
    render(
      <ApiEndpointForm
        open
        initial={makeDraft({ method: "POST", bodyTemplate: '{"q":1}' })}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByLabelText(/body template/i)).toHaveValue('{"q":1}');

    await userEvent.click(screen.getByLabelText(/^method/i));
    await userEvent.click(await screen.findByRole("option", { name: /^get$/i }));

    // Field is gone (GET hides it).
    expect(screen.queryByLabelText(/body template/i)).not.toBeInTheDocument();

    // Flip back to POST — the textarea should be empty (no leaked value).
    await userEvent.click(screen.getByLabelText(/^method/i));
    await userEvent.click(await screen.findByRole("option", { name: /^post$/i }));
    expect(screen.getByLabelText(/body template/i)).toHaveValue("");
  });
});

describe("ApiEndpointForm — placeholder linting", () => {
  it("rejects submit when bodyTemplate references an unknown placeholder", async () => {
    const onSubmit = jest.fn();
    render(
      <ApiEndpointForm
        open
        initial={makeDraft({
          key: "users",
          label: "Users",
          path: "/users",
          method: "POST",
          bodyTemplate: "{{lastSyncAt}}",
        })}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/unknown template variable "lastsyncat"/i)
      ).toBeInTheDocument()
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("accepts submit when bodyTemplate uses only known placeholders", async () => {
    const onSubmit = jest.fn();
    render(
      <ApiEndpointForm
        open
        initial={makeDraft({
          key: "users",
          label: "Users",
          path: "/users",
          method: "POST",
          bodyTemplate: '{"page":{{pageNumber}}}',
        })}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0]![0] as EndpointDraft;
    expect(submitted.bodyTemplate).toBe('{"page":{{pageNumber}}}');
  });
});

describe("ApiEndpointForm — pagination", () => {
  it("renders the pagination strategy dropdown", () => {
    render(
      <ApiEndpointForm open onSubmit={jest.fn()} onClose={jest.fn()} />
    );
    expect(screen.getByLabelText(/pagination strategy/i)).toBeInTheDocument();
  });

  it("submits with the user-selected pagination strategy", async () => {
    const onSubmit = jest.fn();
    render(
      <ApiEndpointForm
        open
        initial={makeDraft({
          key: "users",
          label: "Users",
          path: "/users",
          pagination: {
            ...EMPTY_PAGINATION_DRAFT,
            strategy: "cursor",
            cursorParam: "cursor",
            cursorPlacement: "query",
            cursorResponsePath: "meta.next",
          },
        })}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0]![0] as EndpointDraft;
    expect(submitted.pagination.strategy).toBe("cursor");
  });
});

describe("ApiEndpointForm — autofocus", () => {
  it("focuses the Entity key field when the modal opens", async () => {
    render(
      <ApiEndpointForm open onSubmit={jest.fn()} onClose={jest.fn()} />
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/entity key/i)).toHaveFocus();
    });
  });
});

describe("ApiEndpointForm — Preview button", () => {
  it("is disabled until both Path and Method are filled in", async () => {
    const onPreview = jest
      .fn<
        (draft: EndpointDraft) => Promise<{ body: unknown; truncated: boolean }>
      >()
      .mockResolvedValue({ body: null, truncated: false });
    render(
      <ApiEndpointForm
        open
        onSubmit={jest.fn()}
        onClose={jest.fn()}
        onPreview={onPreview}
      />
    );
    // Initial draft has empty Path → button disabled.
    expect(
      screen.getByRole("button", { name: /preview endpoint response/i })
    ).toBeDisabled();

    // Fill in path → button becomes enabled (method defaults to GET).
    await userEvent.type(screen.getByLabelText(/^path$/i), "/users");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /preview endpoint response/i })
      ).not.toBeDisabled();
    });
  });

  it("invokes onPreview with the current draft when clicked", async () => {
    const onPreview = jest.fn<
      (draft: EndpointDraft) => Promise<{ body: unknown; truncated: boolean }>
    >().mockResolvedValue({ body: { ok: true }, truncated: false });

    render(
      <ApiEndpointForm
        open
        initial={makeDraft({
          key: "users",
          label: "Users",
          path: "/users",
        })}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
        onPreview={onPreview}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: /preview endpoint response/i })
    );

    await waitFor(() => expect(onPreview).toHaveBeenCalledTimes(1));
    const submitted = onPreview.mock.calls[0]![0];
    expect(submitted.path).toBe("/users");
    expect(submitted.method).toBe("GET");
  });

  it("renders the raw response body in the preview pane on success", async () => {
    const onPreview = jest.fn<
      (draft: EndpointDraft) => Promise<{ body: unknown; truncated: boolean }>
    >().mockResolvedValue({
      body: { data: { items: [{ id: "x", name: "Sample" }] } },
      truncated: false,
    });

    render(
      <ApiEndpointForm
        open
        initial={makeDraft({
          key: "users",
          label: "Users",
          path: "/users",
        })}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
        onPreview={onPreview}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: /preview endpoint response/i })
    );

    await waitFor(() => {
      expect(screen.getByTestId("preview-raw")).toHaveTextContent(/"items"/);
    });
    expect(screen.getByTestId("preview-raw")).toHaveTextContent(/Sample/);
  });

  it("surfaces the preview error in an Alert when the SDK call rejects", async () => {
    const onPreview = jest.fn<
      (draft: EndpointDraft) => Promise<{ body: unknown; truncated: boolean }>
    >().mockRejectedValue(new Error("Upstream unreachable"));

    render(
      <ApiEndpointForm
        open
        initial={makeDraft({
          key: "users",
          label: "Users",
          path: "/users",
        })}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
        onPreview={onPreview}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: /preview endpoint response/i })
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /upstream unreachable/i
      );
    });
  });
});

describe("ApiEndpointForm — records source radio (mutual exclusion)", () => {
  it("renders Records path by default and hides the transform editor", () => {
    render(
      <ApiEndpointForm open onSubmit={jest.fn()} onClose={jest.fn()} />
    );
    expect(
      screen.getByRole("radio", { name: /records path/i })
    ).toBeChecked();
    expect(
      screen.getByRole("textbox", { name: /records path/i })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("transform-editor")).not.toBeInTheDocument();
  });

  it("opens in Advanced mode when an existing draft carries a transform", () => {
    render(
      <ApiEndpointForm
        open
        initial={makeDraft({
          key: "users",
          label: "Users",
          path: "/users",
          transform: "data.items",
        })}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByRole("radio", { name: /advanced/i })).toBeChecked();
    expect(screen.getByTestId("transform-editor")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /records path/i })
    ).not.toBeInTheDocument();
  });

  it("switching the radio swaps which input is rendered and clears the other", async () => {
    const onSubmit = jest.fn();
    render(
      <ApiEndpointForm
        open
        initial={makeDraft({
          key: "users",
          label: "Users",
          path: "/users",
          recordsPath: "data.items",
        })}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />
    );

    // Starts on recordsPath.
    expect(
      screen.getByRole("radio", { name: /records path/i })
    ).toBeChecked();

    // Switch to Advanced.
    await userEvent.click(screen.getByRole("radio", { name: /advanced/i }));
    expect(screen.getByRole("radio", { name: /advanced/i })).toBeChecked();
    expect(
      screen.queryByRole("textbox", { name: /records path/i })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("transform-editor")).toBeInTheDocument();

    // Submit — recordsPath should have been cleared on the toggle.
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0]![0] as EndpointDraft;
    expect(submitted.recordsPath).toBe("");
  });
});

// ── AI suggest wiring ────────────────────────────────────────────────

describe("ApiEndpointForm — Suggest button + onSuggest wiring", () => {
  type OnSuggest = NonNullable<
    React.ComponentProps<typeof ApiEndpointForm>["onSuggest"]
  >;
  type SuggestResult = Awaited<ReturnType<OnSuggest>>;

  const makeOnPreview = (body: unknown) =>
    jest
      .fn<
        (draft: EndpointDraft) => Promise<{ body: unknown; truncated: boolean }>
      >()
      .mockResolvedValue({ body, truncated: false });

  it("does not render the Suggest button in recordsPath mode", () => {
    render(
      <ApiEndpointForm open onSubmit={jest.fn()} onClose={jest.fn()} />,
    );
    expect(
      screen.queryByRole("button", { name: /^suggest$/i }),
    ).not.toBeInTheDocument();
  });

  it("renders Suggest in transform mode, disabled until Preview captures a sample", async () => {
    render(
      <ApiEndpointForm
        open
        initial={makeDraft({
          key: "u",
          label: "U",
          path: "/x",
          transform: "data.items",
        })}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /^suggest$/i }),
    ).toBeDisabled();
  });

  it("enables Suggest after a successful Preview, then replaces the textarea on success", async () => {
    const onPreview = makeOnPreview({ data: { items: [{ id: 1 }] } });
    const onSuggest = jest
      .fn<OnSuggest>()
      .mockResolvedValue({
        expression: "data.items",
        warning: null,
      } as SuggestResult);

    render(
      <ApiEndpointForm
        open
        initial={makeDraft({
          key: "u",
          label: "U",
          path: "/x",
          transform: "stale",
        })}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
        onPreview={onPreview}
        onSuggest={onSuggest}
      />,
    );

    // Initially disabled.
    expect(
      screen.getByRole("button", { name: /^suggest$/i }),
    ).toBeDisabled();

    // Click Preview to capture a sample response.
    await userEvent.click(
      screen.getByRole("button", { name: /preview endpoint response/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^suggest$/i }),
      ).not.toBeDisabled(),
    );

    // Click Suggest.
    await userEvent.click(
      screen.getByRole("button", { name: /^suggest$/i }),
    );

    await waitFor(() => expect(onSuggest).toHaveBeenCalledTimes(1));
    const arg = onSuggest.mock.calls[0]![0];
    expect(arg.sampleResponse).toEqual({ data: { items: [{ id: 1 }] } });
    expect(arg.promptHint).toBeUndefined();

    // Textarea is replaced.
    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: /transform expression/i }),
      ).toHaveValue("data.items");
    });
  });

  it("passes the trimmed hint via onSuggest's input arg", async () => {
    const onPreview = makeOnPreview({ data: {} });
    const onSuggest = jest
      .fn<OnSuggest>()
      .mockResolvedValue({
        expression: "data",
        warning: null,
      } as SuggestResult);

    render(
      <ApiEndpointForm
        open
        initial={makeDraft({
          key: "u",
          label: "U",
          path: "/x",
          transform: "stale",
        })}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
        onPreview={onPreview}
        onSuggest={onSuggest}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /preview endpoint response/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^suggest$/i }),
      ).not.toBeDisabled(),
    );

    await userEvent.type(
      screen.getByRole("textbox", { name: /suggestion hint/i }),
      "  one row per order line item  ",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^suggest$/i }),
    );

    await waitFor(() => expect(onSuggest).toHaveBeenCalledTimes(1));
    expect(onSuggest.mock.calls[0]![0].promptHint).toBe(
      "one row per order line item",
    );
  });

  it("surfaces a validation warning in the TransformEditor alert", async () => {
    const onPreview = makeOnPreview({ data: {} });
    const onSuggest = jest
      .fn<OnSuggest>()
      .mockResolvedValue({
        expression: "data.items",
        warning: {
          kind: "validation-failed",
          message: "the expression returned 0 records",
        },
      } as SuggestResult);

    render(
      <ApiEndpointForm
        open
        initial={makeDraft({
          key: "u",
          label: "U",
          path: "/x",
          transform: "stale",
        })}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
        onPreview={onPreview}
        onSuggest={onSuggest}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /preview endpoint response/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^suggest$/i }),
      ).not.toBeDisabled(),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^suggest$/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/the expression returned 0 records/i),
      ).toBeInTheDocument();
    });
  });

  it("clears the validation warning when the user edits the transform textarea", async () => {
    const onPreview = makeOnPreview({ data: {} });
    const onSuggest = jest
      .fn<OnSuggest>()
      .mockResolvedValue({
        expression: "data.items",
        warning: {
          kind: "validation-failed",
          message: "the expression returned 0 records",
        },
      } as SuggestResult);

    render(
      <ApiEndpointForm
        open
        initial={makeDraft({
          key: "u",
          label: "U",
          path: "/x",
          transform: "stale",
        })}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
        onPreview={onPreview}
        onSuggest={onSuggest}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /preview endpoint response/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^suggest$/i }),
      ).not.toBeDisabled(),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^suggest$/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/the expression returned 0 records/i),
      ).toBeInTheDocument(),
    );

    // User edits the textarea — warning should clear.
    await userEvent.type(
      screen.getByRole("textbox", { name: /transform expression/i }),
      "_edited",
    );
    await waitFor(() => {
      expect(
        screen.queryByText(/the expression returned 0 records/i),
      ).not.toBeInTheDocument();
    });
  });

  it("renders the suggester FormAlert when onSuggest rejects", async () => {
    const onPreview = makeOnPreview({ data: {} });
    const onSuggest = jest
      .fn<OnSuggest>()
      .mockRejectedValue(
        Object.assign(new Error("Haiku timed out"), {
          code: "REST_API_TRANSFORM_SUGGEST_FAILED",
        }),
      );

    render(
      <ApiEndpointForm
        open
        initial={makeDraft({
          key: "u",
          label: "U",
          path: "/x",
          transform: "stable",
        })}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
        onPreview={onPreview}
        onSuggest={onSuggest}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /preview endpoint response/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^suggest$/i }),
      ).not.toBeDisabled(),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^suggest$/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/haiku timed out/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/rest_api_transform_suggest_failed/i),
    ).toBeInTheDocument();

    // Transform value should be unchanged from the initial.
    expect(
      screen.getByRole("textbox", { name: /transform expression/i }),
    ).toHaveValue("stable");
  });
});
