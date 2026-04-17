import "@testing-library/jest-dom";
import React from "react";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";

import { NewEntityDialogUI } from "../NewEntityDialog.component";

function setup(
  overrides: Partial<React.ComponentProps<typeof NewEntityDialogUI>> = {}
) {
  const onClose = jest.fn();
  const onSubmit = jest.fn<(key: string, label: string) => void>();
  const utils = render(
    <NewEntityDialogUI
      open
      onClose={onClose}
      onSubmit={onSubmit}
      existingKeys={["ent_existing"]}
      {...overrides}
    />
  );
  return { ...utils, onClose, onSubmit };
}

describe("NewEntityDialogUI", () => {
  test("renders title, fields, and action buttons when open", () => {
    setup();
    expect(screen.getByText(/create new entity/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/label/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/key/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^create$/i })).toBeInTheDocument();
  });

  test("does not render when open is false", () => {
    render(
      <NewEntityDialogUI
        open={false}
        onClose={jest.fn()}
        onSubmit={jest.fn<(key: string, label: string) => void>()}
        existingKeys={[]}
      />
    );
    expect(screen.queryByText(/create new entity/i)).not.toBeInTheDocument();
  });

  test("auto-derives key from label until the key field is edited", () => {
    setup();
    const labelInput = screen.getByLabelText(/label/i) as HTMLInputElement;
    fireEvent.change(labelInput, { target: { value: "Sales Rep" } });
    const keyInput = screen.getByLabelText(/key/i) as HTMLInputElement;
    expect(keyInput.value).toBe("sales_rep");

    // Once user edits key, further label changes don't overwrite it.
    fireEvent.change(keyInput, { target: { value: "rep" } });
    fireEvent.change(labelInput, { target: { value: "Account Rep" } });
    expect(keyInput.value).toBe("rep");
  });

  test("submits (key, label) on valid input and closes", () => {
    const { onSubmit, onClose } = setup();
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "Order" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    expect(onSubmit).toHaveBeenCalledWith("order", "Order");
    expect(onClose).toHaveBeenCalled();
  });

  test("blocks submit when key duplicates an existing key", () => {
    const { onSubmit } = setup({ existingKeys: ["order"] });
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "Order" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/already used/i)).toBeInTheDocument();
  });

  test("rejects invalid key format", () => {
    const { onSubmit } = setup();
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "Something" } });
    const keyInput = screen.getByLabelText(/key/i);
    fireEvent.change(keyInput, { target: { value: "Has Spaces" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText(/lowercase letters, digits, and underscores/i)
    ).toBeInTheDocument();
  });

  test("Cancel closes without calling onSubmit", () => {
    const { onSubmit, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
