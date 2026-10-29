import { jest } from "@jest/globals";

// #916: the "Sign in with SSO" path through the LoginForm container. The SDK
// is mocked so the discovery answer drives the flow.
const withGoogle = jest.fn();
const withEnterpriseConnection = jest.fn();
const discover =
  jest.fn<
    (vars: { email: string }) => Promise<{ connection: string | null }>
  >();
const reset = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    auth: {
      login: () => ({
        withGoogle,
        withUniversal: jest.fn(),
        withQaConnection: jest.fn(),
        withEnterpriseConnection,
      }),
      ssoDiscovery: () => ({
        mutateAsync: discover,
        isPending: false,
        error: null,
        reset,
      }),
    },
  },
  queryKeys: {},
}));

const userEvent = (await import("@testing-library/user-event")).default;
const { render, screen } = await import("./test-utils");
const { LoginForm } = await import("../components/LoginForm.component");

const openSsoAndSubmit = async (email: string) => {
  const user = userEvent.setup();
  render(<LoginForm />);
  await user.click(screen.getByRole("button", { name: "Sign in with SSO" }));
  await user.type(screen.getByLabelText(/work email/i), `${email}{Enter}`);
  return user;
};

describe("LoginForm — Sign in with SSO (#916)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sends a listed domain to its connection with the email as login hint", async () => {
    discover.mockResolvedValue({ connection: "acme-okta" });

    await openSsoAndSubmit("jo@acme.com");

    expect(discover).toHaveBeenCalledWith({ email: "jo@acme.com" });
    expect(withEnterpriseConnection).toHaveBeenCalledWith(
      "acme-okta",
      "jo@acme.com"
    );
  });

  it("keeps an unlisted domain on the form with a pointer to Google", async () => {
    discover.mockResolvedValue({ connection: null });

    await openSsoAndSubmit("jo@globex.io");

    expect(
      await screen.findByText(
        "Single sign-on isn't set up for that email domain. Sign in with Google instead."
      )
    ).toBeInTheDocument();
    expect(withEnterpriseConnection).not.toHaveBeenCalled();
  });

  it("goes back to the sign-in choices", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: "Sign in with SSO" }));

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.getByRole("button", { name: /sign in with google/i })
    ).toBeInTheDocument();
    expect(reset).toHaveBeenCalled();
  });
});
