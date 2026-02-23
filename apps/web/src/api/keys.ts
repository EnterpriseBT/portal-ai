export const queryKeys = {
  health: {
    root: ["health"] as const,
    check: () => [...queryKeys.health.root, "check"] as const,
  },
};
