import {
  ConnectorConfigResponseSchema,
  GoogleConnectorConfigSchema,
} from "../../contracts/connector-config.contract.js";

describe("GoogleConnectorConfigSchema", () => {
  it("accepts the three public identifiers", () => {
    const result = GoogleConnectorConfigSchema.safeParse({
      clientId: "c.apps.googleusercontent.com",
      pickerApiKey: "AIza...",
      cloudProjectNumber: "123456789",
    });
    expect(result.success).toBe(true);
  });

  it("is strict — rejects an extra field (e.g. a leaked secret)", () => {
    const result = GoogleConnectorConfigSchema.safeParse({
      clientId: "c",
      pickerApiKey: "k",
      cloudProjectNumber: "n",
      clientSecret: "leaked",
    });
    expect(result.success).toBe(false);
  });
});

describe("ConnectorConfigResponseSchema", () => {
  it("accepts a populated google config", () => {
    const result = ConnectorConfigResponseSchema.safeParse({
      google: { clientId: "c", pickerApiKey: "k", cloudProjectNumber: "n" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts google: null (unconfigured connector)", () => {
    const result = ConnectorConfigResponseSchema.safeParse({ google: null });
    expect(result.success).toBe(true);
  });

  it("is strict — rejects an unknown sibling field", () => {
    const result = ConnectorConfigResponseSchema.safeParse({
      google: null,
      dropbox: {},
    });
    expect(result.success).toBe(false);
  });
});
