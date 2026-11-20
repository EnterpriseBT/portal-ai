import { registerBlockRenderer } from "@portalai/core";
import { HelpBlockContentSchema } from "@portalai/core/contracts";

import { HelpBlockUI } from "../components/HelpBlock.component";
import { RouterLink } from "../components/RouterLink.component";

/**
 * Registers the renderer for `help` blocks (#1049), `platform_help`'s
 * verbatim help entries. Registered from web bootstrap (`main.tsx`) because
 * its links need the router. Content that isn't a valid help block renders
 * nothing rather than a half-quoted answer. Idempotent.
 */
export function registerHelpBlockRenderer(): void {
  registerBlockRenderer("help", (block) => {
    const parsed = HelpBlockContentSchema.safeParse(block.content);
    if (!parsed.success) return null;
    return <HelpBlockUI content={parsed.data} linkComponent={RouterLink} />;
  });
}
