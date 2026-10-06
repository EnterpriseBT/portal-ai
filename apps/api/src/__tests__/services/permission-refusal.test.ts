import { describe, it, expect } from "@jest/globals";

import { ApiCode } from "../../constants/api-codes.constants.js";
import {
  PERMISSION_DENIED_FALLBACK,
  permissionDenied,
  permissionRefusalMessage,
} from "../../services/permission-refusal.js";
import type {
  PermissionAction,
  PermissionObject,
} from "../../services/permission.service.js";

/**
 * #711: a refusal names the permission that's missing, never a role.
 * Policies govern permissions; roles and groups only package policies.
 */
const msg = permissionRefusalMessage;

describe("permissionRefusalMessage (#711)", () => {
  // Spec case 1.
  it.each([
    ["billing.manage", "manage billing"],
    ["org.delete", "delete the organization"],
    ["org.audit.read", "view the audit log"],
    ["member.role.assign", "manage roles and access"],
    ["member.invite", "invite members"],
    ["member.remove", "remove members"],
  ] as Array<[PermissionAction, string]>)("%s → %s", (action, phrase) => {
    expect(msg(action)).toBe(`You don't have permission to ${phrase}.`);
  });

  // Spec case 2.
  it.each([
    ["resource.read", { type: "tag", id: "t1" }, "view this tag"],
    ["resource.read", { type: "tag" }, "view tags"],
    [
      "resource.write",
      { type: "connector_instance", id: "c1" },
      "edit this connector",
    ],
    [
      "resource.delete",
      { type: "entity_record", id: "r1" },
      "delete this record",
    ],
    ["resource.delete", { type: "pin" }, "delete pinned results"],
    ["resource.share", { type: "curated_view", id: "v1" }, "share this view"],
    ["resource.share", { type: "station" }, "share stations"],
    ["resource.view", { type: "page", id: "connectors" }, "view this page"],
  ] as Array<[PermissionAction, PermissionObject, string]>)(
    "%s on %j → %s",
    (action, object, phrase) => {
      expect(msg(action, object)).toBe(
        `You don't have permission to ${phrase}.`
      );
    }
  );

  // Spec case 3: an id-less write serves creates and entity-wide actions alike.
  it("an id-less write says 'create or edit', never 'create' alone", () => {
    expect(msg("resource.write", { type: "tag" })).toBe(
      "You don't have permission to create or edit tags."
    );
    expect(msg("resource.write", { type: "entity", createdBy: "u1" })).toBe(
      "You don't have permission to create or edit entities."
    );
  });

  // Spec case 4.
  it("falls back for a missing object or an unknown type", () => {
    expect(msg("resource.write")).toBe(PERMISSION_DENIED_FALLBACK);
    expect(msg("resource.read", { type: "not_a_type" })).toBe(
      PERMISSION_DENIED_FALLBACK
    );
    expect(PERMISSION_DENIED_FALLBACK).toBe(
      "You don't have permission to perform this action."
    );
  });

  it("never names a role", () => {
    for (const action of [
      "billing.manage",
      "org.delete",
      "org.audit.read",
      "member.role.assign",
      "member.invite",
      "member.remove",
    ] as const) {
      expect(msg(action)).not.toMatch(/\b(owner|admin|your role)\b/i);
    }
  });
});

describe("permissionDenied (#711)", () => {
  // Spec case 5.
  it("is a 403 PERMISSION_DENIED carrying the message", () => {
    const err = permissionDenied("billing.manage");
    expect(err.status).toBe(403);
    expect(err.code).toBe(ApiCode.PERMISSION_DENIED);
    expect(err.message).toBe("You don't have permission to manage billing.");
  });
});
