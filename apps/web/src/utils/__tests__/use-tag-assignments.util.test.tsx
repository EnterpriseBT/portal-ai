import type React from "react";

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const assignMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule("../../api/sdk", () => ({
  sdk: {
    tagAssignments: {
      list: () => ({ data: { tags: [] } }),
      assign: () => ({ mutateAsync: assignMock }),
      unassign: () => ({ mutate: jest.fn() }),
    },
    entityTags: { search: () => ({ onSearch: jest.fn() }) },
  },
}));

jest.unstable_mockModule("../use-capabilities.util", () => ({
  useCapabilities: () => ({
    canOnResource: () => true,
    capabilitiesKnown: true,
  }),
}));

const { useTagAssignments } = await import("../use-tag-assignments.util");
const { queryKeys } = await import("../../api/keys");

const target = { type: "station", id: "st-1" } as const;

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useTagAssignments(target), { wrapper });
  return { result, invalidate };
}

beforeEach(() => {
  assignMock.mockReset();
});

describe("useTagAssignments", () => {
  it("refetches the object's tags when another tab added the tag first (409)", async () => {
    assignMock.mockRejectedValue({
      code: "ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS",
    });
    const { result, invalidate } = setup();

    act(() => result.current.onAssign("tag-1"));

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: queryKeys.tagAssignments.listByTarget("station", "st-1"),
      })
    );
  });

  it("does not refetch on any other failure", async () => {
    assignMock.mockRejectedValue({ code: "PERMISSION_DENIED" });
    const { result, invalidate } = setup();

    act(() => result.current.onAssign("tag-1"));

    await waitFor(() => expect(assignMock).toHaveBeenCalled());
    await Promise.resolve();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
