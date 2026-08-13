import React from "react";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs, Tab, TabPanel, useTabs } from "../../ui/Tabs";

describe("Tabs Components", () => {
  describe("Rendering", () => {
    it("should render tabs with labels", () => {
      render(
        <Tabs value={0}>
          <Tab label="Tab One" />
          <Tab label="Tab Two" />
        </Tabs>
      );

      expect(screen.getByText("Tab One")).toBeInTheDocument();
      expect(screen.getByText("Tab Two")).toBeInTheDocument();
    });

    it("should render tab panels with content", () => {
      render(
        <>
          <TabPanel value={0} index={0}>
            Panel One Content
          </TabPanel>
          <TabPanel value={0} index={1}>
            Panel Two Content
          </TabPanel>
        </>
      );

      expect(screen.getByText("Panel One Content")).toBeInTheDocument();
      expect(screen.queryByText("Panel Two Content")).not.toBeVisible();
    });
  });

  describe("Interactions", () => {
    it("should switch panels on tab click", () => {
      const TabsExample = () => {
        const [value, setValue] = React.useState(0);
        return (
          <>
            <Tabs value={value} onChange={(_, v) => setValue(v)}>
              <Tab label="First" />
              <Tab label="Second" />
            </Tabs>
            <TabPanel value={value} index={0}>
              First Content
            </TabPanel>
            <TabPanel value={value} index={1}>
              Second Content
            </TabPanel>
          </>
        );
      };

      render(<TabsExample />);

      expect(screen.getByText("First Content")).toBeInTheDocument();
      expect(screen.queryByText("Second Content")).not.toBeVisible();

      fireEvent.click(screen.getByText("Second"));

      expect(screen.queryByText("First Content")).not.toBeVisible();
      expect(screen.getByText("Second Content")).toBeInTheDocument();
    });
  });

  describe("TabPanel", () => {
    it("should only show active panel content", () => {
      render(
        <>
          <TabPanel value={1} index={0}>
            Hidden
          </TabPanel>
          <TabPanel value={1} index={1}>
            Visible
          </TabPanel>
          <TabPanel value={1} index={2}>
            Also Hidden
          </TabPanel>
        </>
      );

      expect(screen.queryByText("Hidden")).not.toBeVisible();
      expect(screen.getByText("Visible")).toBeInTheDocument();
      expect(screen.queryByText("Also Hidden")).not.toBeVisible();
    });

    it("should have correct aria attributes", () => {
      render(
        <TabPanel value={0} index={0}>
          Content
        </TabPanel>
      );

      const panel = screen.getByRole("tabpanel");
      expect(panel).toHaveAttribute("id", "tabpanel-0");
      expect(panel).toHaveAttribute("aria-labelledby", "tab-0");
    });

    it("should accept custom className", () => {
      render(
        <TabPanel value={0} index={0} className="custom-panel">
          Content
        </TabPanel>
      );

      const panel = screen.getByRole("tabpanel");
      expect(panel).toHaveClass("custom-panel");
    });

    it("should accept custom data attributes", () => {
      render(
        <TabPanel value={0} index={0} data-testid="custom-panel">
          Content
        </TabPanel>
      );

      expect(screen.getByTestId("custom-panel")).toBeInTheDocument();
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref on Tabs", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(
        <Tabs ref={ref} value={0}>
          <Tab label="Tab" />
        </Tabs>
      );

      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });

    it("should forward ref on TabPanel", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(
        <TabPanel ref={ref} value={0} index={0}>
          Content
        </TabPanel>
      );

      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe("useTabs", () => {
    const UseTabsExample = ({ initialValue }: { initialValue?: number }) => {
      const { tabsProps, getTabProps, getTabPanelProps } =
        useTabs(initialValue);
      return (
        <>
          <Tabs {...tabsProps}>
            <Tab label="Alpha" {...getTabProps(0)} />
            <Tab label="Beta" {...getTabProps(1)} />
          </Tabs>
          <TabPanel {...getTabPanelProps(0)}>Alpha Content</TabPanel>
          <TabPanel {...getTabPanelProps(1)}>Beta Content</TabPanel>
        </>
      );
    };

    it("should initialize with the default value", () => {
      render(<UseTabsExample />);

      expect(screen.getByText("Alpha Content")).toBeInTheDocument();
      expect(screen.queryByText("Beta Content")).not.toBeVisible();
    });

    it("should initialize with a custom value", () => {
      render(<UseTabsExample initialValue={1} />);

      expect(screen.queryByText("Alpha Content")).not.toBeVisible();
      expect(screen.getByText("Beta Content")).toBeInTheDocument();
    });

    it("should switch tabs on click", () => {
      render(<UseTabsExample />);

      fireEvent.click(screen.getByText("Beta"));

      expect(screen.queryByText("Alpha Content")).not.toBeVisible();
      expect(screen.getByText("Beta Content")).toBeInTheDocument();
    });

    it("should apply correct aria attributes via getTabProps", () => {
      render(<UseTabsExample />);

      const tab = screen.getByText("Alpha").closest("button");
      expect(tab).toHaveAttribute("id", "tab-0");
      expect(tab).toHaveAttribute("aria-controls", "tabpanel-0");
    });

    it("should move the panel when setValue is called (uncontrolled)", () => {
      const Example = () => {
        const { getTabPanelProps, setValue } = useTabs();
        return (
          <>
            <button onClick={() => setValue(1)}>Go Beta</button>
            <TabPanel {...getTabPanelProps(0)}>Alpha Content</TabPanel>
            <TabPanel {...getTabPanelProps(1)}>Beta Content</TabPanel>
          </>
        );
      };

      render(<Example />);
      fireEvent.click(screen.getByText("Go Beta"));

      expect(screen.queryByText("Alpha Content")).not.toBeVisible();
      expect(screen.getByText("Beta Content")).toBeVisible();
    });
  });

  /**
   * Controlled mode (#365). Help drives its tabs from the URL, so the hook
   * needs to render a value it does not own. Passing `options.value` switches
   * the hook to controlled: it renders the caller's value and reports changes
   * instead of applying them. Omitting `options` is the existing behavior,
   * pinned by the uncontrolled tests above.
   */
  describe("useTabs (controlled)", () => {
    const ControlledExample = ({
      value,
      onChange,
    }: {
      value: number;
      onChange: (next: number) => void;
    }) => {
      const { tabsProps, getTabProps, getTabPanelProps, setValue } = useTabs(
        0,
        {
          value,
          onChange,
        }
      );
      return (
        <>
          <Tabs {...tabsProps}>
            <Tab label="Alpha" {...getTabProps(0)} />
            <Tab label="Beta" {...getTabProps(1)} />
          </Tabs>
          <button onClick={() => setValue(0)}>Imperative Alpha</button>
          <TabPanel {...getTabPanelProps(0)}>Alpha Content</TabPanel>
          <TabPanel {...getTabPanelProps(1)}>Beta Content</TabPanel>
        </>
      );
    };

    it("should render the caller's value, not the initial value", () => {
      render(<ControlledExample value={1} onChange={jest.fn()} />);

      expect(screen.queryByText("Alpha Content")).not.toBeVisible();
      expect(screen.getByText("Beta Content")).toBeVisible();
    });

    it("should report a tab click without moving the panel itself", () => {
      const onChange = jest.fn();
      render(<ControlledExample value={0} onChange={onChange} />);

      fireEvent.click(screen.getByText("Beta"));

      expect(onChange).toHaveBeenCalledWith(1);
      // The caller owns the value — until it feeds a new one back in, the
      // rendered tab must not move on its own.
      expect(screen.getByText("Alpha Content")).toBeVisible();
      expect(screen.queryByText("Beta Content")).not.toBeVisible();
    });

    it("should route imperative setValue through onChange", () => {
      const onChange = jest.fn();
      render(<ControlledExample value={1} onChange={onChange} />);

      fireEvent.click(screen.getByText("Imperative Alpha"));

      expect(onChange).toHaveBeenCalledWith(0);
      expect(screen.getByText("Beta Content")).toBeVisible();
    });

    it("should follow the caller's value across re-renders", () => {
      const { rerender } = render(
        <ControlledExample value={0} onChange={jest.fn()} />
      );
      expect(screen.getByText("Alpha Content")).toBeVisible();

      rerender(<ControlledExample value={1} onChange={jest.fn()} />);
      expect(screen.getByText("Beta Content")).toBeVisible();
    });

    it("should keep the same aria id scheme as uncontrolled", () => {
      render(<ControlledExample value={1} onChange={jest.fn()} />);

      const tab = screen.getByText("Beta").closest("button");
      expect(tab).toHaveAttribute("id", "tab-1");
      expect(tab).toHaveAttribute("aria-controls", "tabpanel-1");
      expect(
        screen.getByText("Beta Content").closest("[role=tabpanel]")
      ).toHaveAttribute("aria-labelledby", "tab-1");
    });
  });
});
