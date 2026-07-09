import { render, screen } from "./test-utils";
import { MessageTimestamp } from "../components/MessageTimestamp.component";

// Compute expectations with the same Intl options the component uses, so the
// assertions hold regardless of the CI runner's locale/timezone.
const shortLabel = (ms: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
const fullTooltip = (ms: number) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "long",
  }).format(ms);

describe("MessageTimestamp", () => {
  it("renders a local short date+time label with the full datetime as a tooltip", () => {
    const created = new Date("2026-07-08T20:34:00Z").getTime();
    render(<MessageTimestamp created={created} />);
    const label = screen.getByText(shortLabel(created));
    expect(label).toBeInTheDocument();
    // Accessible: the exact instant (incl. timezone) is on the title, not
    // conveyed by color alone.
    expect(label).toHaveAttribute("title", fullTooltip(created));
  });

  it("renders from `created` only — no relative 'ago' wording", () => {
    const created = new Date("2026-01-02T09:15:00Z").getTime();
    render(<MessageTimestamp created={created} />);
    expect(screen.getByText(shortLabel(created))).toBeInTheDocument();
    expect(screen.queryByText(/ago/i)).not.toBeInTheDocument();
  });
});
