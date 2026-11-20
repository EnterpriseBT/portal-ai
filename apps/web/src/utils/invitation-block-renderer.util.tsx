import { registerBlockRenderer } from "@portalai/core";
import { InvitationBlockContentSchema } from "@portalai/core/contracts";

import { InvitationBlock } from "../components/InvitationBlock.component";

/**
 * Registers the renderer for `invitation` blocks (#847): an invitation
 * `member_invite` or `invitation_show` made or found, with a button that gets
 * a fresh invite link. Registered from web bootstrap (`main.tsx`) because the
 * button calls the SDK. Content that isn't a valid invitation renders nothing.
 * Idempotent.
 */
export function registerInvitationBlockRenderer(): void {
  registerBlockRenderer("invitation", (block) => {
    const parsed = InvitationBlockContentSchema.safeParse(block.content);
    if (!parsed.success) return null;
    return <InvitationBlock content={parsed.data} />;
  });
}
