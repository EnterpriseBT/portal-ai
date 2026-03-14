import React from "react";
import { jest } from "@jest/globals";
import type { DefineRegistryResult, Spec } from "@json-render/react";

const fakeRegistry = { Alert: () => null };

const fakeRegistryDefinition = {
  registry: fakeRegistry,
  handlers: () => ({}),
  executeAction: async () => {},
} as unknown as DefineRegistryResult;

const mockGetCatalog =
  jest.fn<
    (
      name: string
    ) => {
      name: string;
      definition: DefineRegistryResult;
      catalog: unknown;
    } | null
  >();

jest.unstable_mockModule("@portalai/registry", () => ({
  CatalogName: { Blog: "blog" },
  registry: {
    get: mockGetCatalog,
  },
}));

jest.unstable_mockModule("@json-render/react", () => ({
  Renderer: (props: {
    spec: Spec | null;
    registry: unknown;
    loading: boolean;
  }) => (
    <div data-testid="json-renderer" data-loading={String(props.loading)}>
      {props.spec ? JSON.stringify(props.spec) : "no-spec"}
    </div>
  ),
  StateProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  VisibilityProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  ActionProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

const { render, screen } = await import("./test-utils");
const { Renderer } = await import("../components/Renderer.component");
const { CatalogName } = await import("@portalai/registry");
const { ApiError } = await import("../utils/api.util");

const mockSpec: Spec = {
  root: "alert-1",
  elements: {
    "alert-1": {
      type: "Alert",
      props: { variant: "default", title: "Test" },
      children: [],
    },
  },
};

describe("Renderer Component", () => {
  beforeEach(() => {
    mockGetCatalog.mockReturnValue({
      name: "blog",
      definition: fakeRegistryDefinition,
      catalog: {},
    });
  });

  describe("Success State", () => {
    it("should render the JsonRenderer with the catalog registry", () => {
      render(<Renderer catalogName={CatalogName.Blog} spec={mockSpec} />);
      expect(screen.getByTestId("json-renderer")).toBeInTheDocument();
      expect(screen.getByTestId("json-renderer")).toHaveTextContent(
        JSON.stringify(mockSpec)
      );
    });

    it("should pass loading as undefined by default", () => {
      render(<Renderer catalogName={CatalogName.Blog} spec={mockSpec} />);
      expect(screen.getByTestId("json-renderer")).toHaveAttribute(
        "data-loading",
        "undefined"
      );
    });
  });

  describe("Error State", () => {
    it("should show error when catalog is not found", () => {
      mockGetCatalog.mockReturnValue(null);
      render(<Renderer catalogName={CatalogName.Blog} spec={mockSpec} />);
      expect(screen.getByText("Catalog not found")).toBeInTheDocument();
      expect(screen.queryByTestId("json-renderer")).not.toBeInTheDocument();
    });

    it("should show error when error prop is provided", () => {
      const error = new ApiError("Fetch failed", "FETCH_ERROR");
      render(
        <Renderer
          catalogName={CatalogName.Blog}
          spec={mockSpec}
          error={error}
        />
      );
      expect(screen.getByText("Fetch failed")).toBeInTheDocument();
      expect(screen.queryByTestId("json-renderer")).not.toBeInTheDocument();
    });

    it("should prioritize catalog not found over error prop", () => {
      mockGetCatalog.mockReturnValue(null);
      const error = new ApiError("External error", "EXT_ERROR");
      render(
        <Renderer
          catalogName={CatalogName.Blog}
          spec={mockSpec}
          error={error}
        />
      );
      expect(screen.getByText("Catalog not found")).toBeInTheDocument();
      expect(screen.queryByText("External error")).not.toBeInTheDocument();
    });
  });

  describe("Null Spec", () => {
    it("should render JsonRenderer with null spec", () => {
      render(<Renderer catalogName={CatalogName.Blog} spec={null} />);
      expect(screen.getByTestId("json-renderer")).toHaveTextContent("no-spec");
    });
  });
});
