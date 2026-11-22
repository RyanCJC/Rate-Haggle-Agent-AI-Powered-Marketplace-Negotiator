import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CallLog } from "./CallLog";
import type { McpCall } from "../../types";

const base: McpCall = {
  ts: "2026-11-21T13:54:19.985868+00:00",
  run: "run-1",
  server: "marketplace",
  tool: "send_offer",
  ok: true,
  ms: 16,
  error: null,
  args: { turn: 0, price: 820, conversation: "08f7dd66" },
};

describe("CallLog", () => {
  it("renders ok row with time, server.tool, summary, duration and ok result", () => {
    const d = new Date(base.ts);
    const expectedTime = [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, "0"))
      .join(":");
    const html = renderToStaticMarkup(<CallLog calls={[base]} note={null} />);
    expect(html).toContain(expectedTime);
    expect(html).toContain("marketplace.send_offer");
    expect(html).toContain("turn 0, RM 820");
    expect(html).toContain("16 ms");
    expect(html).toContain("ok");
    expect(html).toContain('data-testid="call-row"');
  });

  it("renders a failed row with the error type", () => {
    const html = renderToStaticMarkup(
      <CallLog calls={[{ ...base, ok: false, error: "McpToolError", ms: 0 }]} note={null} />,
    );
    expect(html).toContain("&lt;1 ms");
    expect(html).toContain("McpToolError");
    expect(html).toContain("marketplace.send_offer");
  });

  it("renders a reopened row muted with count", () => {
    const open = (conversation: string): McpCall => ({
      ...base,
      tool: "open_conversation",
      args: { conversation },
    });
    const html = renderToStaticMarkup(<CallLog calls={[open("conv-1"), open("conv-1")]} note={null} />);
    expect(html).toContain("Conversation re-opened (resume)");
    expect(html).toContain("×1");
    expect(html).toContain('data-testid="call-reopened"');
    // the first open_conversation is still a normal row; only the duplicate is collapsed
    expect(html.split("marketplace.open_conversation").length - 1).toBe(1);
  });

  it("renders empty state when there are no calls", () => {
    const html = renderToStaticMarkup(<CallLog calls={[]} note={null} />);
    expect(html).toContain("No MCP calls recorded for this run. The server may have restarted since.");
  });

  it("shows the note as a muted footnote", () => {
    const html = renderToStaticMarkup(<CallLog calls={[base]} note="Calls since this server process started." />);
    expect(html).toContain("Calls since this server process started.");
  });

  it("never truncates the tool name (compact drawer layout)", () => {
    const longTool = { ...base, tool: "a_very_long_tool_name_that_should_not_be_truncated" };
    const html = renderToStaticMarkup(<CallLog calls={[longTool]} note={null} compact={true} />);
    expect(html).toContain("marketplace.a_very_long_tool_name_that_should_not_be_truncated");
    expect(html).toContain('data-testid="call-row"');
  });

  it("keeps the full tool name in wide layout too", () => {
    const longTool = { ...base, tool: "a_very_long_tool_name_that_should_not_be_truncated" };
    const html = renderToStaticMarkup(<CallLog calls={[longTool]} note={null} />);
    expect(html).toContain("marketplace.a_very_long_tool_name_that_should_not_be_truncated");
  });
});
