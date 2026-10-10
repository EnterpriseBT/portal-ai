import { describe, it, expect } from "@jest/globals";
import type { z } from "zod";

import {
  AcceptInvitationRequestSchema,
  BillingCheckoutRequestSchema,
  BillingPortalRequestSchema,
  ColumnDefinitionCreateRequestBodySchema,
  ColumnDefinitionUpdateRequestBodySchema,
  CommitLayoutPlanRequestBodySchema,
  ConnectorEntityCreateRequestBodySchema,
  ConnectorEntityPatchRequestBodySchema,
  ConnectorInstanceCreateRequestBodySchema,
  ConnectorInstancePatchRequestBodySchema,
  CreateApiEndpointRequestBodySchema,
  CreateStationBodySchema,
  CuratedViewAttachRequestBodySchema,
  CuratedViewCreateRequestBodySchema,
  CuratedViewUpdateRequestBodySchema,
  EntityGroupCreateRequestBodySchema,
  EntityGroupMemberCreateRequestBodySchema,
  EntityGroupMemberUpdateRequestBodySchema,
  EntityGroupUpdateRequestBodySchema,
  EntityRecordCreateRequestBodySchema,
  EntityRecordImportRequestBodySchema,
  EntityRecordPatchRequestBodySchema,
  EntityTagAssignmentCreateRequestBodySchema,
  EntityTagCreateRequestBodySchema,
  EntityTagUpdateRequestBodySchema,
  FieldMappingCreateRequestBodySchema,
  FieldMappingUpdateRequestBodySchema,
  FileUploadConfirmRequestBodySchema,
  FileUploadParseSessionRequestBodySchema,
  FileUploadPresignRequestBodySchema,
  GroupMembersSetRequestSchema,
  GroupUpsertRequestSchema,
  InterpretRequestBodySchema,
  InviteCreateRequestSchema,
  LayoutPlanCommitDraftRequestBodySchema,
  LayoutPlanInterpretDraftRequestBodySchema,
  MemberGroupsSetRequestSchema,
  MemberRolesSetRequestSchema,
  OrganizationDeleteRequestSchema,
  OrganizationSwitchRequestSchema,
  PolicyUpsertRequestSchema,
  RegisterToolpackBodySchema,
  RoleUpsertRequestSchema,
  ShareGrantRequestSchema,
  UpdatePortalBodySchema,
  UpdatePortalResultBodySchema,
  UpdateStationBodySchema,
  UpdateToolpackBodySchema,
} from "../../contracts/index.js";

/**
 * #745: request bodies are strict contracts. An unknown top-level key is a
 * 400 naming it (`Unrecognized key: "…"`), not a field the route silently
 * drops. Zod reports the unknown key alongside any other issue, so a body
 * holding only the extra key proves the schema is strict without needing a
 * valid body per schema.
 */
const STRICT_BODIES: Array<[string, z.ZodType]> = [
  ["CuratedViewCreateRequestBodySchema", CuratedViewCreateRequestBodySchema],
  ["CuratedViewUpdateRequestBodySchema", CuratedViewUpdateRequestBodySchema],
  ["CuratedViewAttachRequestBodySchema", CuratedViewAttachRequestBodySchema],
  ["OrganizationDeleteRequestSchema", OrganizationDeleteRequestSchema],
  ["MemberRolesSetRequestSchema", MemberRolesSetRequestSchema],
  ["PolicyUpsertRequestSchema", PolicyUpsertRequestSchema],
  ["RoleUpsertRequestSchema", RoleUpsertRequestSchema],
  ["GroupUpsertRequestSchema", GroupUpsertRequestSchema],
  ["GroupMembersSetRequestSchema", GroupMembersSetRequestSchema],
  ["MemberGroupsSetRequestSchema", MemberGroupsSetRequestSchema],
  ["InviteCreateRequestSchema", InviteCreateRequestSchema],
  ["AcceptInvitationRequestSchema", AcceptInvitationRequestSchema],
  ["OrganizationSwitchRequestSchema", OrganizationSwitchRequestSchema],
  ["ShareGrantRequestSchema", ShareGrantRequestSchema],
  ["BillingCheckoutRequestSchema", BillingCheckoutRequestSchema],
  ["BillingPortalRequestSchema", BillingPortalRequestSchema],
  ["EntityRecordImportRequestBodySchema", EntityRecordImportRequestBodySchema],
  ["EntityRecordPatchRequestBodySchema", EntityRecordPatchRequestBodySchema],
  ["EntityRecordCreateRequestBodySchema", EntityRecordCreateRequestBodySchema],
  ["EntityGroupCreateRequestBodySchema", EntityGroupCreateRequestBodySchema],
  ["EntityGroupUpdateRequestBodySchema", EntityGroupUpdateRequestBodySchema],
  [
    "EntityGroupMemberCreateRequestBodySchema",
    EntityGroupMemberCreateRequestBodySchema,
  ],
  [
    "EntityGroupMemberUpdateRequestBodySchema",
    EntityGroupMemberUpdateRequestBodySchema,
  ],
  ["EntityTagCreateRequestBodySchema", EntityTagCreateRequestBodySchema],
  ["EntityTagUpdateRequestBodySchema", EntityTagUpdateRequestBodySchema],
  [
    "EntityTagAssignmentCreateRequestBodySchema",
    EntityTagAssignmentCreateRequestBodySchema,
  ],
  [
    "ConnectorEntityCreateRequestBodySchema",
    ConnectorEntityCreateRequestBodySchema,
  ],
  [
    "ConnectorEntityPatchRequestBodySchema",
    ConnectorEntityPatchRequestBodySchema,
  ],
  [
    "ConnectorInstanceCreateRequestBodySchema",
    ConnectorInstanceCreateRequestBodySchema,
  ],
  [
    "ConnectorInstancePatchRequestBodySchema",
    ConnectorInstancePatchRequestBodySchema,
  ],
  ["FieldMappingCreateRequestBodySchema", FieldMappingCreateRequestBodySchema],
  ["FieldMappingUpdateRequestBodySchema", FieldMappingUpdateRequestBodySchema],
  [
    "ColumnDefinitionCreateRequestBodySchema",
    ColumnDefinitionCreateRequestBodySchema,
  ],
  [
    "ColumnDefinitionUpdateRequestBodySchema",
    ColumnDefinitionUpdateRequestBodySchema,
  ],
  ["RegisterToolpackBodySchema", RegisterToolpackBodySchema],
  ["UpdateToolpackBodySchema", UpdateToolpackBodySchema],
  [
    "LayoutPlanInterpretDraftRequestBodySchema",
    LayoutPlanInterpretDraftRequestBodySchema,
  ],
  [
    "LayoutPlanCommitDraftRequestBodySchema",
    LayoutPlanCommitDraftRequestBodySchema,
  ],
  ["CommitLayoutPlanRequestBodySchema", CommitLayoutPlanRequestBodySchema],
  ["FileUploadPresignRequestBodySchema", FileUploadPresignRequestBodySchema],
  ["FileUploadConfirmRequestBodySchema", FileUploadConfirmRequestBodySchema],
  [
    "FileUploadParseSessionRequestBodySchema",
    FileUploadParseSessionRequestBodySchema,
  ],
  ["CreateApiEndpointRequestBodySchema", CreateApiEndpointRequestBodySchema],
  ["UpdatePortalBodySchema", UpdatePortalBodySchema],
  ["UpdatePortalResultBodySchema", UpdatePortalResultBodySchema],
  ["CreateStationBodySchema", CreateStationBodySchema],
  ["UpdateStationBodySchema", UpdateStationBodySchema],
];

const unrecognizedKeys = (schema: z.ZodType, body: unknown): string[] => {
  const result = schema.safeParse(body);
  if (result.success) return [];
  return result.error.issues.flatMap((i) =>
    i.code === "unrecognized_keys" ? i.keys : []
  );
};

describe("strict request bodies (#745)", () => {
  it.each(STRICT_BODIES)("%s refuses an unknown key", (_name, schema) => {
    expect(unrecognizedKeys(schema, { __extra: 1 })).toEqual(["__extra"]);
  });

  // The alias of the parser's own InterpretInputSchema stays loose: strict
  // would change the parser's schema too, and the route has no callers.
  it("InterpretRequestBodySchema stays loose", () => {
    expect(
      unrecognizedKeys(InterpretRequestBodySchema, { __extra: 1 })
    ).toEqual([]);
  });
});
