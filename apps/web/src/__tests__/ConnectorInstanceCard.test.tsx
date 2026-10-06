/**
 * #689: a Connected-tab card offers Delete only when the caller may delete
 * that connector instance.
 */
import { jest } from "@jest/globals";

import type { ConnectorInstanceCardUIProps } from "../components/ConnectorInstance.component";

const { render, screen } = await import("./test-utils");
const { ConnectorInstanceCardUI } =
  await import("../components/ConnectorInstance.component");

const instance = (
  del: boolean
): ConnectorInstanceCardUIProps["connectorInstance"] => ({
  id: "ci-1",
  organizationId: "org-1",
  connectorDefinitionId: "cd-1",
  name: "Sales sheet",
  status: "active" as const,
  config: null,
  accountInfo: { identity: null, metadata: {} },
  lastSyncAt: null,
  lastErrorMessage: null,
  enabledCapabilityFlags: { read: true },
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  capabilities: { read: true, write: del, delete: del },
});

describe("ConnectorInstanceCardUI", () => {
  it("offers Delete when the caller may delete the instance", () => {
    render(
      <ConnectorInstanceCardUI
        connectorInstance={instance(true)}
        onDelete={jest.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("hides Delete without delete on the instance", () => {
    render(
      <ConnectorInstanceCardUI
        connectorInstance={instance(false)}
        onDelete={jest.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.getByText("Sales sheet")).toBeInTheDocument();
  });
});
