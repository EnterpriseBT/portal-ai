/**
 * TurnLimitNoticeUI (#498) — the friendly in-session surface for an
 * AGENT_TURN_LIMITED send denial. Pure UI: message + optional upgrade CTA.
 */

import { screen } from "@testing-library/react";
import { render } from "./test-utils";
import { TurnLimitNoticeUI } from "../components/TurnLimitNotice.component";

describe("TurnLimitNoticeUI", () => {
  it("renders the denial message", () => {
    render(
      <TurnLimitNoticeUI
        message="You're sending messages too quickly. Try again in a moment."
        showUpgrade={false}
      />
    );
    expect(
      screen.getByText(/sending messages too quickly/i)
    ).toBeInTheDocument();
    expect(screen.queryByText("View plans")).not.toBeInTheDocument();
  });

  it("offers the upgrade CTA only when showUpgrade is set", () => {
    render(
      <TurnLimitNoticeUI
        message="You've reached your plan's agent-turn limit for today."
        showUpgrade
      />
    );
    expect(screen.getByText("View plans")).toBeInTheDocument();
  });
});
