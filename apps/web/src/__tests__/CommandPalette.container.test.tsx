/**
 * #1076: the command palette wired to search, favorites, Recent, tags, the
 * shell's launcher and the create gates.
 */
import { jest } from "@jest/globals";

import type { ActionGate } from "@portalai/core/ui";

type Result = {
  type: string;
  id: string;
  name: string;
  tags: { id: string; name: string; color: string | null }[];
};
type Params = { q?: string; tag?: string; refs?: string };

const query = (data: unknown, extra: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isError: false,
  isSuccess: data !== undefined,
  isPlaceholderData: false,
  ...extra,
});
const off = () => query(undefined, { isSuccess: false });

let mockFavorites: Result[] = [];
let mockRefs: Result[] = [];
let mockRefsError = false;
let mockResults: Result[] = [];
let mockResultsError = false;
let mockTagged: {
  results: Result[];
  matchedTags: { id: string; name: string }[];
} = { results: [], matchedTags: [] };
let mockPortals: { id: string; name: string; lastOpened: number | null }[] = [];
let mockTags: { id: string; name: string }[] = [];
let mockGate: ActionGate = { kind: "allow" };
const mockSearchCalls: Params[] = [];

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    search: {
      query: (params: Params, opts: { enabled?: boolean }) => {
        if (opts?.enabled === false) return off();
        mockSearchCalls.push(params);
        if (params.q !== undefined) {
          return mockResultsError
            ? query(undefined, { isError: true, isSuccess: false })
            : query({ results: mockResults });
        }
        if (params.tag !== undefined) return query(mockTagged);
        if (params.refs !== undefined) {
          return mockRefsError
            ? query(undefined, { isError: true, isSuccess: false })
            : query({ results: mockRefs });
        }
        return query({ results: mockFavorites });
      },
    },
    portals: {
      list: (_p: unknown, opts: { enabled?: boolean }) =>
        opts?.enabled === false ? off() : query({ portals: mockPortals }),
    },
    entityTags: {
      list: (_p: unknown, opts: { enabled?: boolean }) =>
        opts?.enabled === false ? off() : query({ entityTags: mockTags }),
    },
    organizations: {
      current: () => query({ organization: { id: "org-1" } }),
    },
  },
}));
jest.unstable_mockModule("../utils/use-create-gate.util", () => ({
  useCreateGate: () => mockGate,
}));

const { expectNoAxeViolations, render, screen, waitFor, act } =
  await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { CommandPalette } =
  await import("../components/CommandPalette.component");
const { PortalLauncherContext } =
  await import("../utils/portal-launcher.context");
const { recentVisitsKey } = await import("../utils/use-recent-visits.util");

const launch = jest.fn();
const openChooser = jest.fn();
const launcher = {
  station: { id: "s-ops", name: "Ops" },
  pageStation: null,
  favoriteStations: [
    { id: "s-ops", name: "Ops" },
    { id: "s-fin", name: "Finance" },
  ],
  settling: false,
  gate: { kind: "allow" } as ActionGate,
  pending: false,
  launch,
  chooser: {
    open: false,
    onOpen: openChooser,
    onClose: jest.fn(),
    onSubmit: jest.fn(),
    serverError: null,
  },
};

const auth = {
  session: {
    user: { sub: "auth0|ada", name: "Ada" },
    isAuthenticated: true,
    isLoading: false,
    error: undefined,
  },
};
const KEY = recentVisitsKey("org-1", "auth0|ada");
const result = (type: string, id: string, name: string): Result => ({
  type,
  id,
  name,
  tags: [],
});

const renderPalette = (onClose = jest.fn()) => {
  const view = render(
    <PortalLauncherContext.Provider value={launcher}>
      <CommandPalette open onClose={onClose} />
    </PortalLauncherContext.Provider>,
    { auth }
  );
  return { ...view, onClose };
};
const groupNames = () =>
  screen.queryAllByRole("group").map((g) => {
    const id = g.getAttribute("aria-labelledby");
    return (
      (id && document.getElementById(id)?.textContent) ??
      g.getAttribute("aria-label") ??
      ""
    );
  });
const optionNames = () =>
  screen.getAllByRole("option").map((o) => o.textContent ?? "");
const typeQuery = async (text: string) => {
  await userEvent.type(screen.getByRole("combobox"), text);
  await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
};

beforeEach(() => {
  localStorage.clear();
  mockFavorites = [result("station", "s-fav", "Favorite station")];
  mockRefs = [];
  mockRefsError = false;
  mockResults = [];
  mockResultsError = false;
  mockTagged = { results: [], matchedTags: [] };
  mockPortals = [];
  mockTags = [];
  mockGate = { kind: "allow" };
  mockSearchCalls.length = 0;
  launch.mockReset();
  openChooser.mockReset();
});

describe("CommandPalette (container, #1076)", () => {
  it("shows Actions, Favorites and Recent at home, and passes axe", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([{ type: "curated_view", id: "v1", visitedAt: 100 }])
    );
    mockRefs = [result("curated_view", "v1", "Q3 orders")];
    mockPortals = [{ id: "p1", name: "Chat", lastOpened: 50 }];
    const { baseElement } = renderPalette();
    await waitFor(() =>
      expect(groupNames()).toEqual(["Actions", "Favorites", "Recent"])
    );
    expect(optionNames()).toEqual(
      expect.arrayContaining([
        "New portal in Ops",
        "New portal in Finance",
        "Favorite station· station",
        "Q3 orders· view",
        "Chat· portal",
      ])
    );
    // Recent: newest first across stored visits and portals.
    const recent = optionNames();
    expect(recent.indexOf("Q3 orders· view")).toBeLessThan(
      recent.indexOf("Chat· portal")
    );
    await expectNoAxeViolations(screen.getByRole("dialog"));
    void baseElement;
  });

  it("prunes Recent after a successful hydration, never after a failure", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { type: "station", id: "kept", visitedAt: 2 },
        { type: "station", id: "gone", visitedAt: 1 },
      ])
    );
    mockRefsError = true;
    const first = renderPalette();
    await waitFor(() => expect(groupNames()).toContain("Actions"));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(2);
    first.unmount();

    mockRefsError = false;
    mockRefs = [result("station", "kept", "Kept")];
    renderPalette();
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([
        expect.objectContaining({ id: "kept" }),
      ])
    );
  });

  it("searches once per pause and groups results by type", async () => {
    mockResults = [
      result("station", "s1", "Sales"),
      result("portal", "p1", "Sales chat"),
    ];
    renderPalette();
    await typeQuery("sal");
    const searches = mockSearchCalls.filter((p) => p.q !== undefined);
    expect(searches.map((p) => p.q)).toEqual(["sal"]);
    await waitFor(() => expect(groupNames()).toEqual(["Stations", "Portals"]));
    await expectNoAxeViolations(screen.getByRole("dialog"));
  });

  it("keeps matching actions in a search", async () => {
    renderPalette();
    await typeQuery("new station");
    await waitFor(() => expect(groupNames()).toEqual(["Actions"]));
    expect(optionNames()).toEqual(["New station"]);
  });

  it("searches #tags, labels the group, and hides Actions", async () => {
    mockTagged = {
      results: [result("station", "s1", "Ledger")],
      matchedTags: [{ id: "t1", name: "Finance" }],
    };
    renderPalette();
    await typeQuery("#fin");
    expect(mockSearchCalls.filter((p) => p.tag !== undefined)).toEqual([
      { tag: "fin" },
    ]);
    await waitFor(() => expect(groupNames()).toEqual(["Tagged “Finance”"]));
  });

  it("suggests tags for # alone, and picking one searches it", async () => {
    mockTags = [{ id: "t1", name: "Finance" }];
    renderPalette();
    await typeQuery("#");
    await waitFor(() => expect(groupNames()).toEqual(["Tags"]));
    await userEvent.click(screen.getByRole("option", { name: "#Finance" }));
    expect(screen.getByRole("combobox")).toHaveValue("#Finance");
  });

  it("gates the create actions like their pages and links them", async () => {
    mockGate = { kind: "disable", reason: "Ask for access to create stations" };
    renderPalette();
    const option = await screen.findByRole("option", { name: "New station" });
    expect(option).toHaveAttribute("aria-disabled", "true");
    expect(option).not.toHaveAttribute("href");
    mockGate = { kind: "allow" };
  });

  it("starts a portal through the shell's launcher and closes", async () => {
    const { onClose } = renderPalette();
    await userEvent.click(
      await screen.findByRole("option", { name: "New portal in Finance" })
    );
    expect(launch).toHaveBeenCalledWith("s-fin");
    expect(onClose).toHaveBeenCalled();
  });

  it("opens the station chooser and closes", async () => {
    const { onClose } = renderPalette();
    await userEvent.click(
      await screen.findByRole("option", { name: "New portal: choose station…" })
    );
    expect(openChooser).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("links a create action to its page", async () => {
    renderPalette();
    expect(
      await screen.findByRole("option", { name: "Import a file" })
    ).toHaveAttribute("href", "/connectors?create=file-upload");
  });

  it("shows a failed search and keeps the actions", async () => {
    mockResultsError = true;
    renderPalette();
    await typeQuery("new");
    expect(
      await screen.findByText("Couldn’t search. Try again.")
    ).toBeInTheDocument();
    expect(groupNames()).toEqual(["Actions"]);
    await expectNoAxeViolations(screen.getByRole("dialog"));
  });
});
