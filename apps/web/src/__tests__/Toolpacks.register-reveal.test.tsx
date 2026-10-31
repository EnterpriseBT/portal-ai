import { jest } from "@jest/globals";

/**
 * #911: registering with a secret the dialog generated returns no
 * `signingSecret`, so nothing is revealed; only a secret the API minted
 * (an API caller that omitted it) is shown, once.
 */

const result = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  isSuccess: true,
  error: null,
});
const mutation = () => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn(),
  reset: jest.fn(),
  isPending: false,
  error: null,
});

let registerResponse: Record<string, unknown> = {};
const mockRegisterMutate = jest.fn(
  (_body: unknown, opts?: { onSuccess?: (data: unknown) => void }) =>
    opts?.onSuccess?.(registerResponse)
);

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    toolpacks: {
      list: () => result({ toolpacks: [] }),
      register: () => ({ ...mutation(), mutate: mockRegisterMutate }),
      update: mutation,
      refresh: mutation,
      remove: mutation,
      rotateSigningSecret: mutation,
    },
    organizations: { usage: () => result(undefined) },
  },
  queryKeys: { toolpacks: { root: ["toolpacks"] } },
}));

jest.unstable_mockModule("../utils/use-capabilities.util", () => ({
  useCapabilities: () => ({ canOnResource: () => true }),
}));
jest.unstable_mockModule("../utils/use-action-gate.util", () => ({
  useActionGate: () => ({
    gate: () => ({ kind: "allow" }),
    entitled: () => true,
  }),
}));
jest.unstable_mockModule("../utils/use-builtin-entitlements.util", () => ({
  useBuiltinEntitlements: () => ({
    entitledSlugs: new Set<string>(),
    isEntitled: () => true,
    isLoading: false,
  }),
}));

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { Toolpacks } = await import("../views/Toolpacks.view");

const TOOLPACK = { id: "tp-1", name: "customer_intel" };

async function register() {
  render(<Toolpacks />);
  fireEvent.click(screen.getByRole("button", { name: /register toolpack/i }));
  fireEvent.change(screen.getByLabelText(/Name/), {
    target: { value: "customer_intel" },
  });
  fireEvent.change(screen.getByLabelText(/Schema endpoint/), {
    target: { value: "https://example.com/schema" },
  });
  fireEvent.change(screen.getByLabelText(/Runtime endpoint/), {
    target: { value: "https://example.com/runtime" },
  });
  // The signing secret's generation lands in an effect after open.
  await waitFor(() =>
    expect(
      (screen.getByLabelText(/Signing secret/) as HTMLInputElement).value
    ).toMatch(/^whsec_/)
  );
  fireEvent.click(screen.getByRole("button", { name: "Register" }));
  await waitFor(() => expect(mockRegisterMutate).toHaveBeenCalledTimes(1));
}

describe("Toolpacks view: signing secret reveal after register (#911)", () => {
  beforeEach(() => {
    mockRegisterMutate.mockClear();
  });

  it("shows no reveal when the response carries no signingSecret", async () => {
    registerResponse = { toolpack: TOOLPACK };
    await register();
    expect(
      screen.queryByText("Your toolpack signing secret")
    ).not.toBeInTheDocument();
  });

  it("reveals a secret the API minted", async () => {
    registerResponse = {
      toolpack: TOOLPACK,
      signingSecret: "whsec_" + "m".repeat(43),
    };
    await register();
    expect(
      await screen.findByText("Your toolpack signing secret")
    ).toBeInTheDocument();
  });

  // Each successful registration starts the next one with a fresh secret.
  it("generates a new secret for the next registration after a success", async () => {
    registerResponse = { toolpack: TOOLPACK };
    await register();
    const sent = (
      mockRegisterMutate.mock.calls[0][0] as { signingSecret: string }
    ).signingSecret;

    fireEvent.click(screen.getByRole("button", { name: /register toolpack/i }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/Signing secret/) as HTMLInputElement).value
      ).toMatch(/^whsec_/)
    );
    expect(
      (screen.getByLabelText(/Signing secret/) as HTMLInputElement).value
    ).not.toBe(sent);
  });
});
