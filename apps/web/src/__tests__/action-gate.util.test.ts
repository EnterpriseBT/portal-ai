import { describe, it, expect, jest } from "@jest/globals";

const { decideActionGate, UPGRADE_REASON } =
  await import("../utils/action-gate.util");

// #688: one decider for every action affordance. Precedence is
// permission → tier → state, so the user is told the most durable reason.
describe("decideActionGate (#688)", () => {
  it("allows an action the caller may take, on their plan, with nothing blocking it", () => {
    expect(decideActionGate({ allowed: true })).toEqual({ kind: "allow" });
  });

  it("hides an action the caller isn't permitted", () => {
    expect(decideActionGate({ allowed: false })).toEqual({ kind: "hide" });
  });

  it("disables a page's primary action with the grant hint when the caller could plausibly get it", () => {
    expect(
      decideActionGate({
        allowed: false,
        primary: { plausible: true, grantHint: "Ask an admin for access" },
      })
    ).toEqual({ kind: "disable", reason: "Ask an admin for access" });
  });

  it("hides a primary action the caller couldn't plausibly get", () => {
    expect(
      decideActionGate({
        allowed: false,
        primary: { plausible: false, grantHint: "Ask an admin for access" },
      })
    ).toEqual({ kind: "hide" });
  });

  it("upsells an action the plan excludes, with its reason and onUpgrade", () => {
    const onUpgrade = jest.fn();
    expect(
      decideActionGate({
        allowed: true,
        entitled: false,
        upgradeReason: "Custom toolpacks are on a higher plan",
        onUpgrade,
      })
    ).toEqual({
      kind: "upsell",
      reason: "Custom toolpacks are on a higher plan",
      onUpgrade,
    });
  });

  it("upsells with the standard reason when none is given", () => {
    const gate = decideActionGate({
      allowed: true,
      entitled: false,
      onUpgrade: jest.fn(),
    });
    expect(gate).toMatchObject({ kind: "upsell", reason: UPGRADE_REASON });
  });

  it("disables (rather than upselling to nowhere) when the plan excludes it and there's no onUpgrade", () => {
    expect(decideActionGate({ allowed: true, entitled: false })).toEqual({
      kind: "disable",
      reason: UPGRADE_REASON,
    });
  });

  it("disables an action blocked by transient state, naming it", () => {
    expect(
      decideActionGate({
        allowed: true,
        blocked: "Paused until the running job finishes",
      })
    ).toEqual({
      kind: "disable",
      reason: "Paused until the running job finishes",
    });
  });

  it("treats a null block as nothing blocking", () => {
    expect(decideActionGate({ allowed: true, blocked: null })).toEqual({
      kind: "allow",
    });
  });

  it("permission beats tier: an unpermitted action is hidden, not upsold", () => {
    expect(
      decideActionGate({
        allowed: false,
        entitled: false,
        onUpgrade: jest.fn(),
      })
    ).toEqual({ kind: "hide" });
  });

  it("tier beats state: a plan-excluded action is upsold even while blocked", () => {
    const gate = decideActionGate({
      allowed: true,
      entitled: false,
      onUpgrade: jest.fn(),
      blocked: "Paused until the running job finishes",
    });
    expect(gate.kind).toBe("upsell");
  });
});
