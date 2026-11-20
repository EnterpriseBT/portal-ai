import { jest } from "@jest/globals";

jest.unstable_mockModule("../components/InvitationBlock.component", () => ({
  InvitationBlock: ({ content }: { content: { email: string } }) => (
    <p>invitation for {content.email}</p>
  ),
}));

const { ContentBlockRenderer, hasBlockRenderer } =
  await import("@portalai/core");
const { render, screen } = await import("./test-utils");
const { registerInvitationBlockRenderer } =
  await import("../utils/invitation-block-renderer.util");

describe("registerInvitationBlockRenderer (#847)", () => {
  registerInvitationBlockRenderer();

  const valid = {
    type: "invitation",
    invitationId: "inv-1",
    email: "alice@example.com",
    role: "member",
    status: "pending",
    expiresAt: 1,
  };

  it("renders a valid invitation, and nothing for content that isn't one", () => {
    expect(hasBlockRenderer("invitation")).toBe(true);
    const { unmount } = render(
      <ContentBlockRenderer
        block={{ type: "invitation", content: valid } as never}
      />
    );
    expect(
      screen.getByText("invitation for alice@example.com")
    ).toBeInTheDocument();
    unmount();

    const { container } = render(
      <ContentBlockRenderer
        block={
          {
            type: "invitation",
            content: { ...valid, inviteUrl: "https://x?token=1" },
          } as never
        }
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
