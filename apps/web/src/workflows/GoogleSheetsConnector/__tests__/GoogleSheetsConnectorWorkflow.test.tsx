import { jest } from "@jest/globals";

// #793: the workflow's dialog is accessible on its first step. Every SDK
// endpoint answers idle, so the container renders without a network.
const idle = () => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn(),
  reset: jest.fn(),
  data: undefined,
  error: null,
  isPending: false,
  isLoading: false,
  isError: false,
  isSuccess: false,
});
const anything: object = new Proxy(
  {},
  { get: (_t, key) => (key === "then" ? undefined : anything) }
);
jest.unstable_mockModule("../../../api/sdk", () => ({
  sdk: new Proxy({}, { get: () => new Proxy({}, { get: () => idle }) }),
  queryKeys: anything,
}));

// import.meta.env doesn't exist under Jest.
jest.unstable_mockModule("../../../utils/api-origin.util", () => ({
  apiOrigin: () => "http://localhost:3001",
}));

const { render, screen, expectNoAxeViolations } =
  await import("../../../__tests__/test-utils");
const { GoogleSheetsConnectorWorkflow } =
  await import("../GoogleSheetsConnectorWorkflow.component");

describe("GoogleSheetsConnectorWorkflow (#793)", () => {
  it("has no axe violations when open", async () => {
    render(
      <GoogleSheetsConnectorWorkflow
        open
        onClose={jest.fn()}
        organizationId="org-1"
        connectorDefinitionId="def-1"
      />
    );
    await expectNoAxeViolations(await screen.findByRole("dialog"));
  });
});
