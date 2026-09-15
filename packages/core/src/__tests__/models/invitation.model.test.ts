import {
  INVITATION_STATUSES,
  InvitationStatusSchema,
  InvitationSchema,
  InvitationModel,
  InvitationModelFactory,
} from "../../models/invitation.model.js";
import { StubIDFactory, buildCoreModelFactory } from "../test-utils.js";

const validRow = () => ({
  id: "inv-1",
  created: 1,
  createdBy: "u-owner",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  organizationId: "org-1",
  email: "invitee@example.com",
  role: "member" as const,
  tokenHash: "a".repeat(64),
  status: "pending" as const,
  expiresAt: 1_000_000,
  invitedByUserId: "u-owner",
  acceptedByUserId: null,
  acceptedAt: null,
});

describe("InvitationSchema", () => {
  it("accepts a valid pending row", () => {
    expect(InvitationSchema.safeParse(validRow()).success).toBe(true);
  });

  it("statuses are pending/accepted/revoked/expired", () => {
    expect([...INVITATION_STATUSES]).toEqual([
      "pending",
      "accepted",
      "revoked",
      "expired",
    ]);
    expect(InvitationStatusSchema.safeParse("bogus").success).toBe(false);
  });

  it("rejects an unknown role and a non-numeric expiresAt", () => {
    expect(
      InvitationSchema.safeParse({ ...validRow(), role: "superuser" }).success
    ).toBe(false);
    expect(
      InvitationSchema.safeParse({ ...validRow(), expiresAt: "soon" }).success
    ).toBe(false);
  });

  it("allows accepted rows to carry acceptedBy/acceptedAt", () => {
    const accepted = {
      ...validRow(),
      status: "accepted" as const,
      acceptedByUserId: "u-invitee",
      acceptedAt: 2_000_000,
    };
    expect(InvitationSchema.safeParse(accepted).success).toBe(true);
  });
});

describe("InvitationModelFactory", () => {
  it("create() returns an InvitationModel with a generated id", () => {
    const factory = new InvitationModelFactory({
      coreModelFactory: buildCoreModelFactory(new StubIDFactory("inv-x")),
    });
    const model = factory.create("u-owner");
    expect(model).toBeInstanceOf(InvitationModel);
    const json = model.toJSON();
    expect(json.id).toBe("inv-x-1");
    expect(json.createdBy).toBe("u-owner");
  });

  it("parse() round-trips a fully-populated model", () => {
    const model = new InvitationModel(validRow());
    expect(model.parse()).toEqual(validRow());
  });
});
