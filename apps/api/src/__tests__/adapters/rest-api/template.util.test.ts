import { describe, it, expect } from "@jest/globals";

import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  applyTemplate,
  applyTemplateToConfig,
} from "../../../adapters/rest-api/template.util.js";

describe("applyTemplate — happy path", () => {
  it("substitutes {{pageNumber}}", () => {
    expect(applyTemplate("hello {{pageNumber}}", { cursor: "", pageNumber: 1 })).toBe(
      "hello 1"
    );
  });

  it("substitutes {{cursor}}", () => {
    expect(applyTemplate("c={{cursor}}", { cursor: "abc", pageNumber: 1 })).toBe(
      "c=abc"
    );
  });

  it("substitutes multiple placeholders in one string", () => {
    expect(
      applyTemplate("p={{pageNumber}}&c={{cursor}}", {
        cursor: "abc",
        pageNumber: 2,
      })
    ).toBe("p=2&c=abc");
  });

  it("substitutes an empty cursor as an empty string", () => {
    expect(applyTemplate("c={{cursor}}", { cursor: "", pageNumber: 1 })).toBe(
      "c="
    );
  });

  it("returns plain strings (no placeholders) unchanged", () => {
    expect(applyTemplate("plain string", { cursor: "", pageNumber: 1 })).toBe(
      "plain string"
    );
  });

  it("trims whitespace inside the placeholder delimiters", () => {
    expect(applyTemplate("{{ pageNumber }}", { cursor: "", pageNumber: 1 })).toBe(
      "1"
    );
  });
});

describe("applyTemplate — error paths", () => {
  it("throws REST_API_TEMPLATE_UNKNOWN_VARIABLE for unknown placeholders", () => {
    expect(() =>
      applyTemplate("{{foo}}", { cursor: "", pageNumber: 1 })
    ).toThrow(
      expect.objectContaining({
        code: ApiCode.REST_API_TEMPLATE_UNKNOWN_VARIABLE,
        details: expect.objectContaining({ name: "foo" }),
      })
    );
  });

  it("throws REST_API_TEMPLATE_UNKNOWN_VARIABLE on empty placeholder name", () => {
    expect(() =>
      applyTemplate("{{}}", { cursor: "", pageNumber: 1 })
    ).toThrow(
      expect.objectContaining({
        code: ApiCode.REST_API_TEMPLATE_UNKNOWN_VARIABLE,
      })
    );
  });

  it("reports the first unknown placeholder when several appear", () => {
    expect(() =>
      applyTemplate("{{cursor}}-{{nope}}-{{also}}", {
        cursor: "x",
        pageNumber: 1,
      })
    ).toThrow(
      expect.objectContaining({
        code: ApiCode.REST_API_TEMPLATE_UNKNOWN_VARIABLE,
        details: expect.objectContaining({ name: "nope" }),
      })
    );
  });
});

describe("applyTemplateToConfig", () => {
  it("substitutes per-value across a record", () => {
    const out = applyTemplateToConfig(
      { "X-Page": "{{pageNumber}}", "X-Other": "static" },
      { cursor: "", pageNumber: 7 }
    );
    expect(out).toEqual({ "X-Page": "7", "X-Other": "static" });
  });

  it("returns {} when the input is undefined", () => {
    expect(
      applyTemplateToConfig(undefined, { cursor: "", pageNumber: 1 })
    ).toEqual({});
  });

  it("returns {} when the input is empty", () => {
    expect(applyTemplateToConfig({}, { cursor: "", pageNumber: 1 })).toEqual(
      {}
    );
  });

  it("propagates REST_API_TEMPLATE_UNKNOWN_VARIABLE from an offending value", () => {
    expect(() =>
      applyTemplateToConfig(
        { "X-Page": "{{pageNumber}}", "X-Bad": "{{nope}}" },
        { cursor: "", pageNumber: 1 }
      )
    ).toThrow(
      expect.objectContaining({
        code: ApiCode.REST_API_TEMPLATE_UNKNOWN_VARIABLE,
        details: expect.objectContaining({ name: "nope" }),
      })
    );
  });
});
