import type { ResourcePermissionType } from "@portalai/core/models";
import type { ActionGate } from "@portalai/core/ui";

import { useActionGate } from "./use-action-gate.util";
import { useCapabilities } from "./use-capabilities.util";

/**
 * #708: an index page's Create, as a primary action. `allowed` is
 * `resourcePermissions[type].create` (the create route's own check), never
 * the any-grant `write`. A caller who reads the type but can't create one sees
 * Create disabled with `grantHint`; one who can't read it doesn't see it.
 */
export function useCreateGate(
  type: ResourcePermissionType,
  grantHint: string
): ActionGate {
  const { canOnResource } = useCapabilities();
  const { gate } = useActionGate();
  return gate({
    allowed: canOnResource(type, "create"),
    primary: { plausible: canOnResource(type, "read"), grantHint },
  });
}
