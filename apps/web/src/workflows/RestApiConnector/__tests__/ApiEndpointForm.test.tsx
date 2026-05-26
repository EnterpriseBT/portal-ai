import "@testing-library/jest-dom";
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
