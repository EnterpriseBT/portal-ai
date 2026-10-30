import { jest } from "@jest/globals";

// #916: a refused caller has no membership, and /current and /memberships
// self-provision one (#881). The not-invited page must not call them, or a
// refused caller's every visit re-runs the refusal (and, were the fallback
// ever personal_org, would hand them a stray org). Every
// sdk.<domain>.<action>() call is recorded and answered inertly.

const calls: string[] = [];
const inert = () => ({
  data: undefined,
  isLoading: false,
  isPending: false,
  error: null,
  user: { name: "Refused" },
  isAuthenticated: true,
  mutate: jest.fn(),
  mutateAsync: jest.fn(() => new Promise(() => {})),
  logout: jest.fn(),
});
jest.unstable_mockModule("../api/sdk", () => ({
  sdk: new Proxy(
    {},
    {
      get: (_t, domain: string) =>
        new Proxy(
          {},
          {
            get: (_u, action: string) => () => {
              calls.push(`${domain}.${action}`);
              return inert();
            },
          }
        ),
    }
  ),
  queryKeys: new Proxy({}, { get: () => ({ root: ["x"] }) }),
}));

const { render, screen } = await import("./test-utils");
const { NotInvitedPage } = await import("../routes/not-invited");

describe("NotInvitedPage (#916)", () => {
  beforeEach(() => calls.splice(0));

  it("renders the not-invited state without reading the caller's organization", async () => {
    render(<NotInvitedPage />);

    expect(
      await screen.findByRole("heading", { name: "You need an invitation" })
    ).toBeInTheDocument();
    expect(calls).not.toContain("organizations.current");
    expect(calls).not.toContain("organizations.memberships");
  });
});
