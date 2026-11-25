import { jest } from "@jest/globals";

import type { ActionGate } from "@portalai/core/ui";

let mockDefinitions: { id: string; slug: string; isActive: boolean }[] = [];
let mockGate: ActionGate = { kind: "allow" };
jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    connectorDefinitions: {
      list: () => ({
        data: { connectorDefinitions: mockDefinitions, total: 0 },
        isSuccess: true,
        isError: false,
      }),
    },
  },
}));
jest.unstable_mockModule("../utils/use-create-gate.util", () => ({
  useCreateGate: () => mockGate,
}));

const { render, waitFor } = await import("./test-utils");
const { useConnectorCreateParam } =
  await import("../utils/use-connector-create-param.util");

const Harness = ({ onConnect }: { onConnect: (d: unknown) => void }) => {
  useConnectorCreateParam({
    canReadCatalog: true,
    capabilitiesKnown: true,
    hasWorkflow: (slug) => slug === "file-upload",
    onConnect,
  });
  return null;
};

beforeEach(() => {
  mockGate = { kind: "allow" };
  mockDefinitions = [
    { id: "cd-1", slug: "file-upload", isActive: true },
    { id: "cd-2", slug: "sandbox", isActive: true },
  ];
});

describe("useConnectorCreateParam (#1076)", () => {
  it("starts the workflow for the linked slug", async () => {
    const onConnect = jest.fn();
    render(<Harness onConnect={onConnect} />, {
      initialEntry: "/connectors?create=file-upload",
    });
    await waitFor(() =>
      expect(onConnect).toHaveBeenCalledWith(
        expect.objectContaining({ id: "cd-1" })
      )
    );
  });

  it("opens nothing for an inactive definition, one without a workflow, or a refused create", async () => {
    const onConnect = jest.fn();
    mockDefinitions = [{ id: "cd-1", slug: "file-upload", isActive: false }];
    const first = render(<Harness onConnect={onConnect} />, {
      initialEntry: "/connectors?create=file-upload",
    });
    first.unmount();
    mockDefinitions = [{ id: "cd-2", slug: "sandbox", isActive: true }];
    const second = render(<Harness onConnect={onConnect} />, {
      initialEntry: "/connectors?create=sandbox",
    });
    second.unmount();
    mockDefinitions = [{ id: "cd-1", slug: "file-upload", isActive: true }];
    mockGate = { kind: "disable", reason: "Ask for access to connect data" };
    render(<Harness onConnect={onConnect} />, {
      initialEntry: "/connectors?create=file-upload",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onConnect).not.toHaveBeenCalled();
  });
});
