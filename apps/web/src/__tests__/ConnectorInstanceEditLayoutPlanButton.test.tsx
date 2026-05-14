import { jest } from "@jest/globals";

import { render, screen, fireEvent } from "./test-utils";
import { ConnectorInstanceEditLayoutPlanButtonUI } from "../components/ConnectorInstanceEditLayoutPlanButton.component";

const noop = () => undefined;

describe("ConnectorInstanceEditLayoutPlanButtonUI", () => {
  // ── Case 15 ────────────────────────────────────────────────────────────
  it("case 15 — google-sheets, no lock → renders enabled, fires onClick on click", () => {
    const onClick = jest.fn();
    render(
      <ConnectorInstanceEditLayoutPlanButtonUI
        connectorDefinitionSlug="google-sheets"
        onClick={onClick}
      />
    );

    const button = screen.getByRole("button", { name: /edit layout plan/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("case 15 — file-upload, no lock → renders enabled", () => {
    render(
      <ConnectorInstanceEditLayoutPlanButtonUI
        connectorDefinitionSlug="file-upload"
        onClick={noop}
      />
    );
    expect(
      screen.getByRole("button", { name: /edit layout plan/i })
    ).toBeEnabled();
  });

  it("case 15 — microsoft-excel, no lock → renders enabled", () => {
    render(
      <ConnectorInstanceEditLayoutPlanButtonUI
        connectorDefinitionSlug="microsoft-excel"
        onClick={noop}
      />
    );
    expect(
      screen.getByRole("button", { name: /edit layout plan/i })
    ).toBeEnabled();
  });

  // ── Case 16 ────────────────────────────────────────────────────────────
  it("case 16 — lockedReason set → button disabled, tooltip carries the lock message", async () => {
    const onClick = jest.fn();
    render(
      <ConnectorInstanceEditLayoutPlanButtonUI
        connectorDefinitionSlug="google-sheets"
        lockedReason="A layout plan commit is running on this connector — try again when it finishes."
        onClick={onClick}
      />
    );

    const button = screen.getByRole("button", { name: /edit layout plan/i });
    expect(button).toBeDisabled();

    // Tooltip is rendered when the disabled span is hovered. The
    // tooltip title is queryable directly because MUI renders it
    // when the wrapping span receives focus (jsdom doesn't need a
    // real hover for that), but the most reliable cross-version
    // assertion is on the wrapping span's aria-label / title prop.
    fireEvent.mouseOver(button.parentElement!);
    expect(
      await screen.findByRole("tooltip")
    ).toHaveTextContent(/layout plan commit is running/i);

    // Click should not fire since the button is disabled.
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  // ── Case 17 ────────────────────────────────────────────────────────────
  it("case 17 — unsupported slug → button disabled with 'not supported' tooltip; no click", async () => {
    const onClick = jest.fn();
    render(
      <ConnectorInstanceEditLayoutPlanButtonUI
        connectorDefinitionSlug="sandbox"
        onClick={onClick}
      />
    );

    const button = screen.getByRole("button", { name: /edit layout plan/i });
    expect(button).toBeDisabled();

    fireEvent.mouseOver(button.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      /isn'?t supported/i
    );

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
