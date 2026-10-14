import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthQuery = jest.fn();
const mockUseAuthMutation = jest.fn();
const mockUseAuthFetch = jest.fn(() => ({ fetchWithAuth: jest.fn() }));

jest.unstable_mockModule("../../utils/api.util", () => ({
  WRITE_TIMEOUT_MS: 30_000,
  LONG_WRITE_TIMEOUT_MS: 300_000,
  useAuthQuery: mockUseAuthQuery,
  useAuthMutation: mockUseAuthMutation,
  useAuthFetch: mockUseAuthFetch,
}));

const { layoutPlans } = await import("../../api/layout-plans.api");
const { connectorInstanceLayoutPlans } =
  await import("../../api/connector-instance-layout-plans.api");
const { fileUploads } = await import("../../api/file-uploads.api");
const { apiConnector } = await import("../../api/api-connector.api");
const { connectorInstances } =
  await import("../../api/connector-instances.api");
const { toolpacks } = await import("../../api/toolpacks.api");
const { portalSql } = await import("../../api/portal-sql.api");
const { portalResults } = await import("../../api/portal-results.api");
const { entityRecords } = await import("../../api/entity-records.api");
const { connectorEntities } = await import("../../api/connector-entities.api");
const { organizations } = await import("../../api/organizations.api");

const timeoutOf = () =>
  (mockUseAuthMutation.mock.calls[0][0] as { timeoutMs?: number }).timeoutMs;

// #789: writes default to a 30s bound. These answer synchronously after slow
// work (a model call, a commit, a remote probe or webhook, a SQL re-run, an
// inline import, a cascade delete), so each declares the long bound on its SDK endpoint.
describe("long write timeouts (#789)", () => {
  beforeEach(() => {
    mockUseAuthMutation.mockReset();
  });

  it.each([
    ["layoutPlans.interpret", () => layoutPlans.interpret()],
    ["layoutPlans.commit", () => layoutPlans.commit()],
    [
      "connectorInstanceLayoutPlans.interpret",
      () => connectorInstanceLayoutPlans.interpret("ci-1"),
    ],
    [
      "connectorInstanceLayoutPlans.commit",
      () => connectorInstanceLayoutPlans.commit("ci-1", "lp-1"),
    ],
    ["fileUploads.confirm", () => fileUploads.confirm()],
    ["fileUploads.parse", () => fileUploads.parse()],
    [
      "apiConnector.endpoints.discoverColumns",
      () => apiConnector.endpoints.discoverColumns("ci-1", "ce-1"),
    ],
    [
      "apiConnector.endpoints.probeDraft",
      () => apiConnector.endpoints.probeDraft(),
    ],
    [
      "apiConnector.endpoints.previewPage",
      () => apiConnector.endpoints.previewPage(),
    ],
    [
      "apiConnector.endpoints.suggestTransform",
      () => apiConnector.endpoints.suggestTransform(),
    ],
    [
      "connectorInstances.testConnection",
      () => connectorInstances.testConnection("ci-1"),
    ],
    ["toolpacks.refresh", () => toolpacks.refresh()],
    ["toolpacks.register", () => toolpacks.register()],
    ["toolpacks.update", () => toolpacks.update("tp-1")],
    // Cascade deletes: every record and wide table, in one transaction.
    ["connectorInstances.delete", () => connectorInstances.delete("ci-1")],
    ["connectorEntities.delete", () => connectorEntities.delete("ce-1")],
    ["organizations.delete", () => organizations.delete("org-1")],
    ["portalSql.widgetRefresh", () => portalSql.widgetRefresh()],
    ["portalResults.refresh", () => portalResults.refresh()],
    ["entityRecords.import", () => entityRecords.import("ce-1")],
  ])("%s declares LONG_WRITE_TIMEOUT_MS", (_, call) => {
    call();
    expect(timeoutOf()).toBe(300_000);
  });

  it.each([
    // A 202 enqueue answers at once; the job's progress arrives over SSE.
    ["entityRecords.revalidate", () => entityRecords.revalidate("ce-1")],
    ["connectorInstances.sync", () => connectorInstances.sync("ci-1")],
    ["connectorInstances.rename", () => connectorInstances.rename("ci-1")],
  ])("%s keeps the default bound", (_, call) => {
    call();
    expect(timeoutOf()).toBeUndefined();
  });
});
