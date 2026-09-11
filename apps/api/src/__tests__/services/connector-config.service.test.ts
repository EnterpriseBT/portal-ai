/**
 * ConnectorConfigService (#580) — the public connector-config projection.
 * Injected env so the configured/null branches are unit-tested directly.
 */

import { describe, it, expect } from "@jest/globals";

import { ConnectorConfigService } from "../../services/connector-config.service.js";

const full = {
  GOOGLE_OAUTH_CLIENT_ID: "c.apps.googleusercontent.com",
  GOOGLE_PICKER_API_KEY: "AIzaKEY",
  GOOGLE_CLOUD_PROJECT_NUMBER: "123456789",
};

describe("ConnectorConfigService.getConnectorConfig", () => {
  it("returns the three public Google identifiers when all are set", () => {
    expect(ConnectorConfigService.getConnectorConfig(full)).toEqual({
      google: {
        clientId: "c.apps.googleusercontent.com",
        pickerApiKey: "AIzaKEY",
        cloudProjectNumber: "123456789",
      },
    });
  });

  it("never includes a client secret (only the three public fields)", () => {
    const { google } = ConnectorConfigService.getConnectorConfig(full);
    expect(Object.keys(google ?? {})).toEqual([
      "clientId",
      "pickerApiKey",
      "cloudProjectNumber",
    ]);
  });

  it.each([
    ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID"],
    ["GOOGLE_PICKER_API_KEY", "GOOGLE_PICKER_API_KEY"],
    ["GOOGLE_CLOUD_PROJECT_NUMBER", "GOOGLE_CLOUD_PROJECT_NUMBER"],
  ])("returns google: null when %s is missing", (_label, key) => {
    expect(
      ConnectorConfigService.getConnectorConfig({ ...full, [key]: "" })
    ).toEqual({ google: null });
  });
});
