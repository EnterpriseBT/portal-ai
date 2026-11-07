import { pendingGate } from "../../ui/ActionGate";

// #793: a dialog's buttons while it saves: disabled with a reason, still
// focusable (rendered through GatedButton), rather than natively disabled.
describe("pendingGate", () => {
  it("disables with 'Saving…' while pending", () => {
    expect(pendingGate(true)).toEqual({ kind: "disable", reason: "Saving…" });
  });

  it("takes a caller's reason", () => {
    expect(pendingGate(true, "Wait for the save to finish")).toEqual({
      kind: "disable",
      reason: "Wait for the save to finish",
    });
  });

  it("allows when not pending", () => {
    expect(pendingGate(false)).toEqual({ kind: "allow" });
  });
});
