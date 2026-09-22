import { describe, it, expect } from "@jest/globals";
import {
  PolicyStatementInputSchema,
  PolicyUpsertRequestSchema,
  PolicyViewSchema,
  PolicyListResponseSchema,
} from "../../contracts/rbac-authoring.contract.js";

describe("RBAC authoring contracts — policy (#622)", () => {
  const stmt = {
    effect: "allow" as const,
    verb: "read" as const,
    resourceType: "station" as const,
    resourceId: null,
    condition: null,
  };

  it("PolicyStatementInput accepts the full vocabulary incl. wildcards + instance + condition", () => {
    expect(PolicyStatementInputSchema.safeParse(stmt).success).toBe(true);
    expect(
      PolicyStatementInputSchema.safeParse({
        effect: "allow",
        verb: "*",
        resourceType: "*",
        resourceId: null,
        condition: null,
      }).success
    ).toBe(true);
    expect(
      PolicyStatementInputSchema.safeParse({
        effect: "deny",
        verb: "read",
        resourceType: "view",
        resourceId: "view-123",
        condition: "created_by_caller",
      }).success
    ).toBe(true);
  });

  it("PolicyStatementInput rejects a bad effect/verb/resourceType", () => {
    expect(
      PolicyStatementInputSchema.safeParse({ ...stmt, effect: "maybe" }).success
    ).toBe(false);
    expect(
      PolicyStatementInputSchema.safeParse({ ...stmt, verb: "frobnicate" })
        .success
    ).toBe(false);
    expect(
      PolicyStatementInputSchema.safeParse({ ...stmt, resourceType: "planet" })
        .success
    ).toBe(false);
  });

  it("PolicyUpsertRequest requires a name + at least one statement", () => {
    expect(
      PolicyUpsertRequestSchema.safeParse({
        name: "Analysts",
        statements: [stmt],
      }).success
    ).toBe(true);
    // Empty name → rejected.
    expect(
      PolicyUpsertRequestSchema.safeParse({ name: "", statements: [stmt] })
        .success
    ).toBe(false);
    // Empty statements → rejected.
    expect(
      PolicyUpsertRequestSchema.safeParse({ name: "X", statements: [] }).success
    ).toBe(false);
  });

  it("PolicyView + PolicyListResponse shapes round-trip", () => {
    const view = {
      id: "pol-1",
      name: "Analysts",
      kind: "custom" as const,
      description: null,
      statements: [stmt],
    };
    expect(PolicyViewSchema.safeParse(view).success).toBe(true);
    expect(
      PolicyListResponseSchema.safeParse({ policies: [view] }).success
    ).toBe(true);
  });
});
