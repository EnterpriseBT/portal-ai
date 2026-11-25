import type { EntityTag } from "@portalai/core/models";
import type { SelectOption } from "@portalai/core/ui";

import { TagColorDotUI } from "../components/TagColorDot.component";

/** A tag as a picker option, led by its colour dot (#1115). */
export const tagSelectOption = (tag: EntityTag): SelectOption => ({
  value: tag.id,
  label: tag.name,
  icon: tag.color ? <TagColorDotUI color={tag.color} /> : undefined,
});
