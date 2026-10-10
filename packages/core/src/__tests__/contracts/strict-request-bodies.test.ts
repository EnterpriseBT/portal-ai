import { describe, it, expect } from "@jest/globals";
import type { z } from "zod";

import * as contracts from "../../contracts/index.js";

/**
 * #745: request bodies are strict contracts. An unknown top-level key is a
 * 400 naming it (`Unrecognized key: "…"`), not a field the route silently
 * drops. Zod reports the unknown key alongside any other issue, so a body
 * holding only the extra key proves the schema is strict without needing a
 * valid body per schema.
 *
 * The sweep covers every exported `*BodySchema` / `*RequestSchema`, so a new
 * request body is strict unless it is recorded in `LOOSE` with its reason.
 * `LOOSE` only shrinks.
 */
const LOOSE: Record<string, string> = {
  InterpretRequestBodySchema:
    "alias of the parser's own InterpretInputSchema; strict would change the parser",
  PatchLayoutPlanBodySchema: "a z.record: every key is data",
  TestConnectionRequestBodySchema:
    "catchall by design: each adapter reads its own keys",
  GoogleSheetsSelectSheetRequestSchema:
    "SDK input (path id + body), never parsed on the wire",
  GoogleSheetsSheetSliceRequestSchema:
    "SDK input (path id + query), never parsed on the wire",
  MicrosoftExcelSelectWorkbookRequestSchema:
    "SDK input (path id + body), never parsed on the wire",
  MicrosoftExcelSheetSliceRequestSchema:
    "SDK input (path id + query), never parsed on the wire",
};

const isRequestBodyName = (name: string): boolean =>
  /(BodySchema|RequestSchema)$/.test(name) &&
  !/(Query|Response|Payload)/.test(name);

const isSchema = (v: unknown): v is z.ZodType =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as { safeParse?: unknown }).safeParse === "function";

const REQUEST_BODIES: Array<[string, z.ZodType]> = Object.entries(contracts)
  .filter(([name, v]) => isRequestBodyName(name) && isSchema(v))
  .map(([name, v]) => [name, v as z.ZodType]);

const STRICT_BODIES = REQUEST_BODIES.filter(([name]) => !(name in LOOSE));

const unrecognizedKeys = (schema: z.ZodType, body: unknown): string[] => {
  const result = schema.safeParse(body);
  if (result.success) return [];
  return result.error.issues.flatMap((i) =>
    i.code === "unrecognized_keys" ? i.keys : []
  );
};

describe("strict request bodies (#745)", () => {
  it("finds the request bodies to check", () => {
    // A rename that stops matching the sweep would empty it silently.
    expect(STRICT_BODIES.length).toBeGreaterThan(50);
    expect(STRICT_BODIES.map(([n]) => n)).toEqual(
      expect.arrayContaining([
        "UpdatePortalBodySchema",
        "OrganizationDeleteRequestSchema",
        "CreateStationBodySchema",
      ])
    );
  });

  it.each(STRICT_BODIES)("%s refuses an unknown key", (_name, schema) => {
    expect(unrecognizedKeys(schema, { __extra: 1 })).toEqual(["__extra"]);
  });

  it("every LOOSE entry is still an exported request body", () => {
    const names = REQUEST_BODIES.map(([n]) => n);
    for (const name of Object.keys(LOOSE)) expect(names).toContain(name);
  });

  it("InterpretRequestBodySchema stays loose", () => {
    expect(
      unrecognizedKeys(contracts.InterpretRequestBodySchema, { __extra: 1 })
    ).toEqual([]);
  });
});
