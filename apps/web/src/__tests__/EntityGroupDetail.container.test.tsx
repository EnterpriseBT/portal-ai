/**
 * #982: the container's loading and not-found states keep the page's one h1
 * (#797), so a screen reader lands on it and the route announcer can title
 * the tab. Before, a deleted group left "Entity group not found" with no h1.
 */
import { jest } from "@jest/globals";

type QueryState = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: Error | null;
};
let groupQuery: QueryState;

// Every other SDK hook the container calls is inert: an idle query, a
// mutation that does nothing, a search that finds nothing.
const inert = () => ({
  data: undefined,
  isLoading: false,
  isError: false,
  isSuccess: false,
  error: null,
  isPending: false,
  mutate: jest.fn(),
  mutateAsync: jest.fn(),
  reset: jest.fn(),
  onSearch: async () => [],
});
const domain = (overrides: Record<string, unknown> = {}) =>
  new Proxy(overrides, {
    get: (target, key: string) => target[key] ?? inert,
  });

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: new Proxy(
    { entityGroups: domain({ get: () => groupQuery }) },
    {
      get: (target: Record<string, unknown>, key: string) =>
        target[key] ?? domain(),
    }
  ),
  queryKeys: new Proxy({}, { get: () => ({ root: ["root"] }) }),
}));

const { render, screen } = await import("./test-utils");
const { EntityGroupDetailView } =
  await import("../views/EntityGroupDetail.view");

const base = {
  data: undefined,
  isLoading: false,
  isError: false,
  isSuccess: false,
  error: null,
};

describe("EntityGroupDetailView (container) — page heading (#982)", () => {
  it.each<[string, QueryState]>([
    ["loading", { ...base, isLoading: true }],
    [
      "not found",
      { ...base, isError: true, error: new Error("Entity group not found") },
    ],
  ])("keeps exactly one h1 while %s", (_state, query) => {
    groupQuery = query;
    render(<EntityGroupDetailView entityGroupId="grp-1" />);
    // Exactly one h1, named the page and nothing else (not the error copy).
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Entity group" })
    ).toBeInTheDocument();
  });
});
