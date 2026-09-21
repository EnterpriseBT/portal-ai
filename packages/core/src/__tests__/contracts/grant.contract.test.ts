import { describe, it, expect } from "@jest/globals";
import {
  ShareGrantRequestSchema,
  GrantViewSchema,
  GrantListResponseSchema,
} from "../../contracts/grant.contract.js";

describe("ShareGrantRequestSchema (#621)", () => {
  it("accepts a user grantee at read", () => {
    expect(
      ShareGrantRequestSchema.safeParse({
        resourceType: "station",
        resourceId: "st-1",
        grantee: { type: "user", userId: "u-2" },
        access: "read",
      }).success
    ).toBe(true);
  });

  it("accepts a team grantee at read-write", () => {
    expect(
      ShareGrantRequestSchema.safeParse({
        resourceType: "pin",
        resourceId: "p-1",
        grantee: { type: "team" },
        access: "read-write",
      }).success
    ).toBe(true);
  });

  it("rejects an unknown access level", () => {
    expect(
      ShareGrantRequestSchema.safeParse({
        resourceType: "station",
        resourceId: "st-1",
        grantee: { type: "user", userId: "u-2" },
        access: "admin",
      }).success
    ).toBe(false);
  });

  it("rejects a non-shareable resource type", () => {
    expect(
      ShareGrantRequestSchema.safeParse({
        resourceType: "entity_record",
        resourceId: "e-1",
        grantee: { type: "team" },
        access: "read",
      }).success
    ).toBe(false);
  });

  it("rejects a user grantee missing userId", () => {
    expect(
      ShareGrantRequestSchema.safeParse({
        resourceType: "station",
        resourceId: "st-1",
        grantee: { type: "user" },
        access: "read",
      }).success
    ).toBe(false);
  });
});

describe("GrantView / GrantListResponse (#621)", () => {
  const view = {
    id: "g-1",
    principalType: "user" as const,
    principalId: "u-2",
    principalLabel: "a@b.com",
    access: "read-write" as const,
  };

  it("GrantView round-trips", () => {
    expect(GrantViewSchema.safeParse(view).success).toBe(true);
  });

  it("GrantView rejects a bad access", () => {
    expect(
      GrantViewSchema.safeParse({ ...view, access: "owner" }).success
    ).toBe(false);
  });

  it("GrantListResponse wraps a grants array", () => {
    expect(GrantListResponseSchema.safeParse({ grants: [view] }).success).toBe(
      true
    );
  });
});
