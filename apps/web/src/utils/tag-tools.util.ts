/**
 * #1071: the agent tools that change tags. A portal turn that ran one leaves
 * the Tags page, every object's tag list and every taggable list stale, so
 * the session refreshes them when the turn ends.
 */
export const TAG_WRITE_TOOLS = [
  "tag_create",
  "tag_update",
  "tag_delete",
  "tag_assign",
  "tag_unassign",
] as const;

/** Whether a turn that ran `toolNames` may have changed tags. */
export const changedTags = (toolNames: ReadonlySet<string>): boolean =>
  TAG_WRITE_TOOLS.some((name) => toolNames.has(name));
