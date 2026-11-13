import { jest } from "@jest/globals";

const { render, screen, fireEvent, waitFor, expectNoAxeViolations } =
  await import("./test-utils");
const { HighlightedCode } =
  await import("../components/HighlightedCode.component");

describe("HighlightedCode", () => {
  it("renders plain monospaced code when no language is provided", () => {
    render(
      <HighlightedCode
        label="Snippet"
        code='const x = "hello";'
        data-testid="hc-plain"
      />
    );
    const block = screen.getByTestId("hc-plain");
    expect(block.textContent).toBe('const x = "hello";');
    // No hljs token classes when language is omitted.
    expect(block.querySelector(".hljs-keyword")).toBeNull();
    expect(block.querySelector(".hljs-string")).toBeNull();
  });

  it("highlights TypeScript keywords + strings when language='typescript'", () => {
    render(
      <HighlightedCode
        label="Snippet"
        code='const greet: string = "hello";'
        language="typescript"
        data-testid="hc-ts"
      />
    );
    const block = screen.getByTestId("hc-ts");
    // The full text is preserved verbatim …
    expect(block.textContent).toBe('const greet: string = "hello";');
    // … but tokens are wrapped in hljs class spans.
    expect(block.querySelector(".hljs-keyword")?.textContent).toBe("const");
    expect(block.querySelector(".hljs-string")?.textContent).toBe('"hello"');
  });

  it("highlights JSON strings + numbers when language='json'", () => {
    render(
      <HighlightedCode
        label="Snippet"
        code='{"name": "Acme", "founded": 1923}'
        language="json"
        data-testid="hc-json"
      />
    );
    const block = screen.getByTestId("hc-json");
    expect(block.textContent).toBe('{"name": "Acme", "founded": 1923}');
    expect(block.querySelector(".hljs-number")?.textContent).toBe("1923");
    expect(
      Array.from(block.querySelectorAll(".hljs-string")).map(
        (n) => n.textContent
      )
    ).toContain('"Acme"');
  });

  it("renders a copy button by default + writes the code to the clipboard on click", async () => {
    const writeText = jest
      .fn<(t: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <HighlightedCode
        label="Snippet"
        code='{"x":1}'
        language="json"
        data-testid="hc-copy"
      />
    );
    const copyButton = screen.getByTestId("hc-copy-copy");
    expect(copyButton).toBeInTheDocument();
    fireEvent.click(copyButton);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('{"x":1}');
    });
  });

  it("hides the copy button when showCopyButton=false", () => {
    render(
      <HighlightedCode
        label="Snippet"
        code='{"x":1}'
        showCopyButton={false}
        data-testid="hc-no-copy"
      />
    );
    expect(screen.queryByTestId("hc-no-copy-copy")).not.toBeInTheDocument();
  });

  it("falls back to plain text for an unsupported language", () => {
    // The HighlightLanguage type is the public contract, but at runtime
    // a string we don't recognise should degrade gracefully rather than
    // throw. Cast to bypass the compile-time check that this test is
    // guarding against runtime regression.
    render(
      <HighlightedCode
        label="Snippet"
        code="lambda x: x + 1"
        language={"haskell" as never}
        data-testid="hc-fallback"
      />
    );
    const block = screen.getByTestId("hc-fallback");
    expect(block.textContent).toBe("lambda x: x + 1");
    expect(block.querySelector(".hljs-keyword")).toBeNull();
  });

  it("is a focusable region named by its label, so a keyboard can scroll it (#799)", () => {
    render(<HighlightedCode label="Result" code='{"x":1}' language="json" />);
    const region = screen.getByRole("region", { name: "Result" });
    expect(region.tagName).toBe("PRE");
    expect(region).toHaveAttribute("tabindex", "0");
    // Colours come from the theme's [data-code-block] rules (palette.code).
    expect(region).toHaveAttribute("data-code-block");
  });

  it("takes keyboard focus", () => {
    render(<HighlightedCode label="Result" code='{"x":1}' language="json" />);
    const region = screen.getByRole("region", { name: "Result" });
    region.focus();
    expect(region).toHaveFocus();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <HighlightedCode label="Result" code='{"x":1}' language="json" />
    );
    await expectNoAxeViolations(container);
  });
});
