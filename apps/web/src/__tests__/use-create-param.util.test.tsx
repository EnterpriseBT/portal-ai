import { jest } from "@jest/globals";

const { render, waitFor, act } = await import("@testing-library/react");
const {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} = await import("@tanstack/react-router");
const { useCreateParam } = await import("../utils/use-create-param.util");

type Gate = Parameters<typeof useCreateParam>[0]["gate"];

const setup = async (entry: string) => {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  const onOpen = jest.fn();
  const Harness = ({ gate, ready }: { gate: Gate; ready: boolean }) => {
    useCreateParam({ gate, ready, onOpen });
    return null;
  };
  const view = (gate: Gate, ready = true) => (
    <RouterContextProvider router={router}>
      <Harness gate={gate} ready={ready} />
    </RouterContextProvider>
  );
  return { router, onOpen, view };
};

const searchOf = (router: { state: { location: { search: unknown } } }) =>
  router.state.location.search as Record<string, unknown>;

describe("useCreateParam (#1076)", () => {
  it("opens on ?create= with an allow gate, then removes the param", async () => {
    const { router, onOpen, view } = await setup("/stations?create=station");
    render(view({ kind: "allow" }));
    await waitFor(() => expect(searchOf(router).create).toBeUndefined());
    expect(onOpen).toHaveBeenCalledWith("station");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Gate]>([
    ["disable", { kind: "disable", reason: "Ask for access" }],
    ["hide", { kind: "hide" }],
  ])("drops the param without opening on a %s gate", async (_k, gate) => {
    const { router, onOpen, view } = await setup("/stations?create=station");
    render(view(gate));
    await waitFor(() => expect(searchOf(router).create).toBeUndefined());
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("waits until the page is ready", async () => {
    const { router, onOpen, view } = await setup("/stations?create=station");
    const { rerender } = render(view({ kind: "allow" }, false));
    expect(onOpen).not.toHaveBeenCalled();
    expect(searchOf(router).create).toBe("station");
    rerender(view({ kind: "allow" }, true));
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
  });

  it("reacts when the param appears on the same page", async () => {
    const { router, onOpen, view } = await setup("/stations");
    render(view({ kind: "allow" }));
    expect(onOpen).not.toHaveBeenCalled();
    await act(() =>
      router.navigate({
        to: "/stations",
        search: { create: "station" },
      } as never)
    );
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("station"));
    await waitFor(() => expect(searchOf(router).create).toBeUndefined());
  });
});
