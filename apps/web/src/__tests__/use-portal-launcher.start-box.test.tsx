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
const mockMutate = jest.fn<(body: unknown, options: MutateOptions) => void>();
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
        mutate: mockMutate,
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
  mockReset.mockReset();
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
