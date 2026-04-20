import { jest } from "@jest/globals";
import { z } from "zod";

import {
  validateWithSchema,
  focusFirstInvalidField,
} from "../utils/form-validation.util";

const TestSchema = z.object({
  name: z.string().min(1, "Name is required"),
  age: z.number().min(0, "Age must be non-negative"),
});

const NestedSchema = z.object({
  address: z.object({
    city: z.string().min(1, "City is required"),
    zip: z.string().min(1, "Zip is required"),
  }),
});

describe("validateWithSchema", () => {
  it("returns success with parsed data for valid input", () => {
    const result = validateWithSchema(TestSchema, { name: "Alice", age: 30 });
    expect(result).toEqual({ success: true, data: { name: "Alice", age: 30 } });
  });

  it("returns field-keyed errors for invalid input", () => {
    const result = validateWithSchema(TestSchema, { name: "", age: -1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.name).toBe("Name is required");
      expect(result.errors.age).toBe("Age must be non-negative");
    }
  });

  it("handles nested paths with dot notation", () => {
    const result = validateWithSchema(NestedSchema, {
      address: { city: "", zip: "" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors["address.city"]).toBe("City is required");
      expect(result.errors["address.zip"]).toBe("Zip is required");
    }
  });

  it("keeps first error per field when multiple issues exist", () => {
    const schema = z.object({
      value: z.string().min(3, "Too short").max(5, "Too long"),
    });
    const result = validateWithSchema(schema, { value: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.value).toBe("Too short");
    }
  });
});

describe("focusFirstInvalidField", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("focuses the first element with aria-invalid='true'", () => {
    container.innerHTML = `
      <input id="a" />
      <input id="b" aria-invalid="true" />
      <input id="c" aria-invalid="true" />
    `;
    const target = container.querySelector<HTMLElement>("#b")!;
    const focusSpy = jest.spyOn(target, "focus");

    focusFirstInvalidField(container);

    expect(focusSpy).toHaveBeenCalled();
  });

  it("falls back to .Mui-error input when no aria-invalid is found", () => {
    container.innerHTML = `
      <input id="a" />
      <div class="Mui-error"><input id="b" /></div>
      <div class="Mui-error"><textarea id="c"></textarea></div>
    `;
    const target = container.querySelector<HTMLElement>("#b")!;
    const focusSpy = jest.spyOn(target, "focus");

    focusFirstInvalidField(container);

    expect(focusSpy).toHaveBeenCalled();
  });

  it("falls back to .Mui-error textarea", () => {
    container.innerHTML = `
      <div class="Mui-error"><textarea id="t"></textarea></div>
    `;
    const target = container.querySelector<HTMLElement>("#t")!;
    const focusSpy = jest.spyOn(target, "focus");

    focusFirstInvalidField(container);

    expect(focusSpy).toHaveBeenCalled();
  });

  it("does nothing when no invalid fields exist", () => {
    container.innerHTML = `<input id="a" /><input id="b" />`;
    // Should not throw
    focusFirstInvalidField(container);
  });

  it("calls scrollIntoView on the target element", () => {
    container.innerHTML = `<input id="a" aria-invalid="true" />`;
    const target = container.querySelector<HTMLElement>("#a")!;
    target.scrollIntoView = jest.fn();

    focusFirstInvalidField(container);

    expect(target.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      behavior: "smooth",
    });
  });

  it("uses document as root when no container is provided", () => {
    container.innerHTML = `<input id="a" aria-invalid="true" />`;
    const target = container.querySelector<HTMLElement>("#a")!;
    const focusSpy = jest.spyOn(target, "focus");

    focusFirstInvalidField();

    expect(focusSpy).toHaveBeenCalled();
  });

  it("prefers aria-invalid over .Mui-error", () => {
    container.innerHTML = `
      <div class="Mui-error"><input id="mui" /></div>
      <input id="aria" aria-invalid="true" />
    `;
    const ariaTarget = container.querySelector<HTMLElement>("#aria")!;
    const muiTarget = container.querySelector<HTMLElement>("#mui")!;
    const ariaFocusSpy = jest.spyOn(ariaTarget, "focus");
    const muiFocusSpy = jest.spyOn(muiTarget, "focus");

    focusFirstInvalidField(container);

    expect(ariaFocusSpy).toHaveBeenCalled();
    expect(muiFocusSpy).not.toHaveBeenCalled();
  });
});
