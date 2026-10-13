/**
 * #780: a REST endpoint's entity card offers "Test endpoint", which opens
 * the endpoint Test dialog. The action renders only when the view wires
 * it (an entity backed by an endpoint) and follows its gate.
 */
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import type { ConnectorEntityCardUIProps } from "../components/ConnectorEntity.component";

const { render, screen } = await import("./test-utils");
const { ConnectorEntityCardUI } =
  await import("../components/ConnectorEntity.component");

const entity = {
  id: "ent-1",
  organizationId: "org-1",
  connectorInstanceId: "ci-1",
  key: "users",
  label: "Users",
  fieldMappings: [],
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
} as unknown as ConnectorEntityCardUIProps["connectorEntity"];

const expand = async () =>
  userEvent.click(
    screen.getByRole("button", { name: /expand field mappings/i })
  );

describe("ConnectorEntityCardUI — Test endpoint (#780)", () => {
  it("renders no Test action when onTestEndpoint is unset", async () => {
    render(<ConnectorEntityCardUI connectorEntity={entity} />);
    await expand();
    expect(
      screen.queryByRole("button", { name: /test endpoint/i })
    ).not.toBeInTheDocument();
  });

  it("calls onTestEndpoint on click without collapsing the card", async () => {
    const onTestEndpoint = jest.fn();
    render(
      <ConnectorEntityCardUI
        connectorEntity={entity}
        onTestEndpoint={onTestEndpoint}
      />
    );
    await expand();
    await userEvent.click(
      screen.getByRole("button", { name: "Test endpoint users" })
    );
    expect(onTestEndpoint).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: /collapse field mappings/i })
    ).toBeInTheDocument();
  });

  it("renders a disable gate as aria-disabled with its reason, and doesn't fire", async () => {
    const onTestEndpoint = jest.fn();
    render(
      <ConnectorEntityCardUI
        connectorEntity={entity}
        onTestEndpoint={onTestEndpoint}
        testEndpointGate={{ kind: "disable", reason: "Not now" }}
      />
    );
    await expand();
    const button = screen.getByRole("button", { name: "Test endpoint users" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    await userEvent.hover(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Not now");
    await userEvent.click(button);
    expect(onTestEndpoint).not.toHaveBeenCalled();
  });

  it("renders nothing for a hide gate", async () => {
    render(
      <ConnectorEntityCardUI
        connectorEntity={entity}
        onTestEndpoint={jest.fn()}
        testEndpointGate={{ kind: "hide" }}
      />
    );
    await expand();
    expect(
      screen.queryByRole("button", { name: /test endpoint/i })
    ).not.toBeInTheDocument();
  });
});
