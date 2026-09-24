import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { renderHook } from "@testing-library/react";

const mockCurrent = jest.fn();
const navigate = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: { organizations: { current: mockCurrent } },
}));
jest.unstable_mockModule("@tanstack/react-router", () => ({
  useRouter: () => ({ navigate }),
}));

const { useRequirePageView } =
  await import("../utils/use-require-page-view.util");

const withPages = (pages: Record<string, boolean> | undefined) => ({
  data:
    pages === undefined
      ? undefined
      : {
          roles: ["member"],
          capabilities: {},
          organization: {},
          pagePermissions: pages,
        },
});

describe("useRequirePageView (#630 route guard)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("allows + renders when the caller may view the page; no redirect", () => {
    mockCurrent.mockReturnValue(withPages({ connectors: true }));
    const { result } = renderHook(() => useRequirePageView("connectors"));
    expect(result.current.allowed).toBe(true);
    expect(result.current.render).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("redirects to Dashboard + stops rendering when the page is denied (known)", () => {
    mockCurrent.mockReturnValue(withPages({ connectors: false }));
    const { result } = renderHook(() => useRequirePageView("connectors"));
    expect(result.current.allowed).toBe(false);
    expect(result.current.render).toBe(false);
    expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("renders optimistically while the current-org query is loading; no redirect", () => {
    mockCurrent.mockReturnValue(withPages(undefined));
    const { result } = renderHook(() => useRequirePageView("connectors"));
    expect(result.current.known).toBe(false);
    expect(result.current.render).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("allows when ANY of several page ids is viewable (Connectors sub-tabs)", () => {
    mockCurrent.mockReturnValue(
      withPages({ connectors: false, connector_catalog: true })
    );
    const { result } = renderHook(() =>
      useRequirePageView(["connectors", "connector_catalog"])
    );
    expect(result.current.allowed).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("redirects when NONE of several page ids is viewable", () => {
    mockCurrent.mockReturnValue(
      withPages({ connectors: false, connector_catalog: false })
    );
    renderHook(() => useRequirePageView(["connectors", "connector_catalog"]));
    expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });
});
