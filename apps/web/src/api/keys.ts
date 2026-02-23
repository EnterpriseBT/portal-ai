export const queryKeys = {
  health: {
    root: ["health"] as const,
    check: () => [...queryKeys.health.root, "check"] as const,
  },
  organizations: {
    root: ["organizations"] as const,
    current: () => [...queryKeys.organizations.root, "current"] as const,
  },
};
