import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectionsDrawer } from "./ConnectionsDrawer";

describe("ConnectionsDrawer header", () => {
  it("renders pop-out link and close control as siblings in the drawer header", () => {
    const html = renderToStaticMarkup(
      <ConnectionsDrawer runId="abc123def456" runActive={false} open={true} />,
    );
    // Header contains the pop-out link.
    expect(html).toContain('data-testid="connections-popout"');
    expect(html).toContain("Open in a new window");
    // Close control is present as a button with aria-label "Close" and keeps its testid/text.
    expect(html).toContain('data-testid="close-connections"');
    expect(html).toContain('aria-label="Close"');
    // Pop-out link and close button are distinct elements (both present).
    expect((html.match(/data-testid="connections-popout"/g) ?? []).length).toBe(1);
    expect((html.match(/data-testid="close-connections"/g) ?? []).length).toBe(1);
  });

  it("renders only the trigger when closed", () => {
    const html = renderToStaticMarkup(
      <ConnectionsDrawer runId="abc123def456" runActive={false} />,
    );
    expect(html).toContain('data-testid="open-connections"');
    expect(html).not.toContain("data-testid=\"connections-popout\"");
    expect(html).not.toContain('data-testid="close-connections"');
  });
});
