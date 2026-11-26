const { expectNoAxeViolations, render, screen, within } =
  await import("./test-utils");
const { NeedsAttentionUI } =
  await import("../components/NeedsAttention.component");

const job = (id: string) => ({
  id,
  type: "revalidation" as const,
  status: "stalled" as const,
  where: `Entity ${id}`,
  updated: Date.now(),
});

describe("NeedsAttentionUI", () => {
  it("lists each job", async () => {
    const { container } = render(
      <NeedsAttentionUI jobs={[job("j1"), job("j2")]} />
    );
    const list = screen.getByRole("list", { name: "Jobs needing attention" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    await expectNoAxeViolations(container);
  });

  it("says All clear with nothing waiting", async () => {
    const { container } = render(<NeedsAttentionUI jobs={[]} />);
    expect(screen.getByText("All clear")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
    await expectNoAxeViolations(container);
  });
});
