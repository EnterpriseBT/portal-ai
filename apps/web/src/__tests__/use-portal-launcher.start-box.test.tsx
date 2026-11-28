/**
 * #1079: the dashboard's start box starts portals through the shell's one
 * launcher, with its first question. Its errors are its own: they never reach
 * the chooser dialog and never toast.
 */
import { jest } from "@jest/globals";

import type { PortalLauncher } from "../utils/use-portal-launcher.util";

type MutateOptions = {
  toast?: unknown;
  invalidate?: unknown;
  onSuccess?: (data: unknown) => void;
};

let mockCreateError: { message: string; code: string } | null;
// The launcher creates through `mutateAsync`; each call's promise is settled
// by the test.
let mockSettle: {
  resolve: (data: unknown) => void;
  reject: (e: unknown) => void;
};
const mockMutate =
  jest.fn<(body: unknown, options: MutateOptions) => Promise<unknown>>();
const mockReset = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    stations: {
      get: () => ({ data: undefined, isPending: false, error: null }),
      list: () => ({
        data: { stations: [], total: 0 },
        isPending: false,
        isLoading: false,
      }),
    },
    portals: {
      list: () => ({ data: { portals: [] }, isPending: false }),
      create: () => ({
        mutateAsync: mockMutate,
        reset: mockReset,
        isPending: false,
        error: mockCreateError,
      }),
    },
  },
  queryKeys: { portals: { root: ["portals"] } },
}));

jest.unstable_mockModule("../utils/use-create-gate.util", () => ({
  useCreateGate: () => ({ kind: "allow" }),
}));

const { act, render, waitFor } = await import("./test-utils");
const { usePortalLauncher } = await import("../utils/use-portal-launcher.util");
const { hasPendingFirstTurn } =
  await import("../utils/portal-initial-message.util");

let launcher!: PortalLauncher;
const capture = (value: PortalLauncher) => {
  launcher = value;
};
const Probe = ({ onValue = capture }: { onValue?: typeof capture }) => {
  onValue(usePortalLauncher());
  return null;
};

const lastCall = () => {
  const [body, options] = mockMutate.mock.calls.at(-1)!;
  return { body, options };
};

beforeEach(() => {
  mockCreateError = null;
  mockMutate.mockReset();
  mockMutate.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        mockSettle = { resolve, reject };
      })
  );
  mockReset.mockReset();
  sessionStorage.clear();
});

describe("usePortalLauncher startBox (#1079)", () => {
  it("creates the portal with its first question and refreshes portals", () => {
    render(<Probe />);
    act(() =>
      launcher.startBox.onStart({
        stationId: "s1",
        initialMessage: "Top accounts",
      })
    );
    const { body, options } = lastCall();
    expect(body).toEqual({ stationId: "s1", initialMessage: "Top accounts" });
    expect(options.invalidate).toEqual([["portals"]]);
    // The box shows its own failure; it never toasts.
    expect(options.toast).toBeUndefined();
  });

  it("opens the portal to answer an admitted question", async () => {
    const { router } = render(<Probe />);
    act(() =>
      launcher.startBox.onStart({
        stationId: "s1",
        initialMessage: "Top accounts",
      })
    );
    act(() =>
      lastCall().options.onSuccess!({
        portal: { id: "p-1" },
        initialMessage: { status: "pending" },
      })
    );
    await waitFor(() =>
      expect(router.history.location.pathname).toBe("/portals/p-1")
    );
    expect(router.history.location.state.pendingInitialMessage).toBe(true);
    expect(router.history.location.state.refusedInitialMessage).toBeUndefined();
  });

  it("opens the portal carrying a refused question", async () => {
    const { router } = render(<Probe />);
    act(() =>
      launcher.startBox.onStart({
        stationId: "s1",
        initialMessage: "Top accounts",
      })
    );
    act(() =>
      lastCall().options.onSuccess!({
        portal: { id: "p-2" },
        initialMessage: {
          status: "refused",
          code: "AGENT_TURN_LIMITED",
          message:
            "You're sending messages too quickly. Try again in a moment.",
          retryAfterSeconds: 30,
        },
      })
    );
    await waitFor(() =>
      expect(router.history.location.pathname).toBe("/portals/p-2")
    );
    expect(router.history.location.state.refusedInitialMessage).toEqual({
      prompt: "Top accounts",
      message: "You're sending messages too quickly. Try again in a moment.",
    });
  });

  // #1137 adversarial walk: Back pressed before the create answered. The
  // mark is written from the request's promise, so it lands even though the
  // box is gone, and the portal answers its question when it's next opened.
  it("remembers an admitted question for its portal, even after the caller leaves", async () => {
    const { unmount } = render(<Probe />);
    act(() =>
      launcher.startBox.onStart({
        stationId: "s1",
        initialMessage: "Top accounts",
      })
    );
    unmount();
    await act(async () =>
      mockSettle.resolve({
        portal: { id: "p-9" },
        initialMessage: { status: "pending" },
      })
    );
    expect(hasPendingFirstTurn("p-9")).toBe(true);
  });

  it("remembers nothing for a refused question or a failed start", async () => {
    render(<Probe />);
    act(() =>
      launcher.startBox.onStart({ stationId: "s1", initialMessage: "One" })
    );
    await act(async () =>
      mockSettle.resolve({
        portal: { id: "p-10" },
        initialMessage: {
          status: "refused",
          code: "AGENT_TURN_LIMITED",
          message: "Limit",
          retryAfterSeconds: 30,
        },
      })
    );
    act(() =>
      launcher.startBox.onStart({ stationId: "s1", initialMessage: "Two" })
    );
    await act(async () => mockSettle.reject(new Error("boom")));
    expect(hasPendingFirstTurn("p-10")).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });

  it("keeps a start-box failure in the box, out of the chooser", () => {
    mockCreateError = { message: "Couldn't start", code: "PORTAL_FAILED" };
    const { rerender } = render(<Probe />);
    act(() =>
      launcher.startBox.onStart({
        stationId: "s1",
        initialMessage: "Top accounts",
      })
    );
    rerender(<Probe />);
    expect(launcher.startBox.serverError).toEqual(
      expect.objectContaining({ message: "Couldn't start" })
    );
    expect(launcher.chooser.serverError).toBeNull();
  });

  it("still toasts a failed launch, which the box doesn't show", () => {
    mockCreateError = { message: "Couldn't start", code: "PORTAL_FAILED" };
    const { rerender } = render(<Probe />);
    act(() => launcher.launch("s1"));
    rerender(<Probe />);
    expect(lastCall().options.toast).toEqual({
      error: "Couldn't start the portal.",
    });
    expect(launcher.startBox.serverError).toBeNull();
  });
});
