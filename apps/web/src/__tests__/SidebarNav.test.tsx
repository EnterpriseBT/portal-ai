import { useState } from "react";
import { render, screen } from "./test-utils";
import userEvent from "@testing-library/user-event";
import { SidebarNavUI } from "../components/SidebarNav.component";
import { Box, Typography } from "@portalai/core/ui";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";

describe("SidebarNavUI", () => {
  const defaultProps = {
    collapsed: false,
    hidden: false,
  };

  it("renders children", () => {
    render(
      <SidebarNavUI {...defaultProps}>
        <div>Nav Content</div>
      </SidebarNavUI>
    );

    expect(screen.getByText("Nav Content")).toBeInTheDocument();
  });

  it("renders footer as ReactNode", () => {
    render(
      <SidebarNavUI {...defaultProps} footer={<div>Footer Content</div>}>
        <div>Nav Content</div>
      </SidebarNavUI>
    );

    expect(screen.getByText("Footer Content")).toBeInTheDocument();
  });

  it("renders footer from render prop function", () => {
    render(
      <SidebarNavUI
        {...defaultProps}
        footer={() => <div>Render Prop Footer</div>}
      >
        <div>Nav Content</div>
      </SidebarNavUI>
    );

    expect(screen.getByText("Render Prop Footer")).toBeInTheDocument();
  });

  it("does not render footer divider when no footer", () => {
    const { container } = render(
      <SidebarNavUI {...defaultProps}>
        <div>Nav Content</div>
      </SidebarNavUI>
    );

    expect(container.querySelector("hr")).not.toBeInTheDocument();
  });

  it("renders footer divider when footer is present", () => {
    const { container } = render(
      <SidebarNavUI {...defaultProps} footer={<div>Footer</div>}>
        <div>Nav Content</div>
      </SidebarNavUI>
    );

    expect(container.querySelector("hr")).toBeInTheDocument();
  });

  it("hides drawer when hidden is true", () => {
    render(
      <SidebarNavUI {...defaultProps} hidden={true}>
        <div>Nav Content</div>
      </SidebarNavUI>
    );

    const wrapper = screen
      .getByText("Nav Content")
      .closest(".MuiDrawer-root")?.parentElement;
    expect(wrapper).toHaveStyle({ display: "none" });
  });

  it("shows drawer when hidden is false", () => {
    render(
      <SidebarNavUI {...defaultProps} hidden={false}>
        <div>Nav Content</div>
      </SidebarNavUI>
    );

    const wrapper = screen
      .getByText("Nav Content")
      .closest(".MuiDrawer-root")?.parentElement;
    expect(wrapper).not.toHaveStyle({ display: "none" });
  });
});

const VersionFooter = ({
  collapsed,
  version = "dev-abc123",
  sha = "abc123",
}: {
  collapsed: boolean;
  version?: string;
  sha?: string;
}) => {
  const [versionOpen, setVersionOpen] = useState(false);
  return (
    <>
      <Typography
        variant="caption"
        color="text.secondary"
        onClick={() => setVersionOpen(true)}
        sx={{ cursor: "pointer" }}
      >
        {collapsed
          ? `\u00A9 ${new Date().getFullYear()}`
          : `Portalsai \u00A9 ${new Date().getFullYear()}`}
      </Typography>
      <Dialog
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        maxWidth="xs"
      >
        <DialogContent>
          <Typography variant="body2">App version</Typography>
          <Box component="code">
            {version} ({sha})
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
};

describe("Version footer", () => {
  it("displays copyright with 'Portalsai' prefix when expanded", () => {
    render(
      <SidebarNavUI
        collapsed={false}
        hidden={false}
        footer={<VersionFooter collapsed={false} />}
      >
        <div>Nav</div>
      </SidebarNavUI>
    );

    const year = new Date().getFullYear();
    expect(screen.getByText(`Portalsai \u00A9 ${year}`)).toBeInTheDocument();
  });

  it("displays copyright without prefix when collapsed", () => {
    render(
      <SidebarNavUI
        collapsed={true}
        hidden={false}
        footer={<VersionFooter collapsed={true} />}
      >
        <div>Nav</div>
      </SidebarNavUI>
    );

    const year = new Date().getFullYear();
    expect(screen.getByText(`\u00A9 ${year}`)).toBeInTheDocument();
  });

  it("does not show version dialog by default", () => {
    render(
      <SidebarNavUI
        collapsed={false}
        hidden={false}
        footer={<VersionFooter collapsed={false} />}
      >
        <div>Nav</div>
      </SidebarNavUI>
    );

    expect(screen.queryByText("App version")).not.toBeInTheDocument();
  });

  it("opens version dialog on copyright click", async () => {
    const user = userEvent.setup();
    render(
      <SidebarNavUI
        collapsed={false}
        hidden={false}
        footer={
          <VersionFooter collapsed={false} version="dev-abc123" sha="abc123" />
        }
      >
        <div>Nav</div>
      </SidebarNavUI>
    );

    const year = new Date().getFullYear();
    await user.click(screen.getByText(`Portalsai \u00A9 ${year}`));

    expect(screen.getByText("App version")).toBeInTheDocument();
    expect(screen.getByText("dev-abc123 (abc123)")).toBeInTheDocument();
  });

  it("displays version and SHA in the dialog", async () => {
    const user = userEvent.setup();
    render(
      <SidebarNavUI
        collapsed={false}
        hidden={false}
        footer={
          <VersionFooter collapsed={false} version="v1.2.3" sha="deadbeef" />
        }
      >
        <div>Nav</div>
      </SidebarNavUI>
    );

    const year = new Date().getFullYear();
    await user.click(screen.getByText(`Portalsai \u00A9 ${year}`));

    expect(screen.getByText("v1.2.3 (deadbeef)")).toBeInTheDocument();
  });
});
