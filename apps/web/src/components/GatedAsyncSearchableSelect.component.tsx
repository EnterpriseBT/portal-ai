import React from "react";

import {
  AsyncSearchableSelect,
  type AsyncSearchableSelectProps,
} from "@portalai/core/ui";
import type { ResourcePermissionType } from "@portalai/core/models";

import { useCapabilities } from "../utils/use-capabilities.util";
import { UnauthorizedState } from "./UnauthorizedState.component";

export type GatedAsyncSearchableSelectProps = AsyncSearchableSelectProps & {
  /** The object type whose `read` gates this picker (#630). When the caller
   *  lacks it, an unauthorized message replaces the dropdown rather than showing
   *  an empty/filtered list. */
  resourceType: ResourcePermissionType;
};

/**
 * An {@link AsyncSearchableSelect} that surfaces an unauthorized message when the
 * caller cannot `read` the object type it picks (#630). This is the one place
 * that wires object-read gating into a dropdown; a consumer picking gated data
 * passes `resourceType` and this handles the rest. Optimistic while the
 * current-org query loads. The server still filters/403s regardless — this is the
 * honest UI surface, not the boundary.
 *
 * (Thin container over core's pure `AsyncSearchableSelect`: its only logic is the
 * gate check; all rendering delegates to that already-tested pure component.)
 */
export const GatedAsyncSearchableSelect: React.FC<
  GatedAsyncSearchableSelectProps
> = ({ resourceType, ...props }) => {
  const { canOnResource, capabilitiesKnown } = useCapabilities();
  if (capabilitiesKnown && !canOnResource(resourceType, "read")) {
    return (
      <UnauthorizedState message="You don't have permission to select this." />
    );
  }
  return <AsyncSearchableSelect {...props} />;
};
