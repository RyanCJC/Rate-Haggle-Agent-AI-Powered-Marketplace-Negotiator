import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LoadError } from "./LoadError";

describe("LoadError", () => {
  it("renders the calm message with a Retry button", () => {
    const onRetry = vi.fn();
    const html = renderToStaticMarkup(<LoadError message="Could not load MCP information." onRetry={onRetry} />);
    expect(html).toContain("Could not load MCP information.");
    expect(html).toContain("Retry");
    expect(html).toContain('data-testid="load-error-retry"');
  });

  it("uses a default message when none is provided", () => {
    const html = renderToStaticMarkup(<LoadError onRetry={vi.fn()} />);
    expect(html).toContain("Could not load MCP information.");
  });
});
