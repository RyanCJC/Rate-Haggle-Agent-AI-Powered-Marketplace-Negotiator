import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerCard } from "./ServerCard";
import type { McpServer } from "../../types";

const server: McpServer = {
  id: "marketplace",
  name: "haggle-marketplace",
  transport: "stdio",
  status: "connected",
  tools: [
    {
      name: "send_offer",
      description: "Send a price offer to the seller and wait for their reply.",
      params: [
        { name: "turn", type: "integer", required: true },
        { name: "price", type: "any", required: false },
      ],
    },
    {
      name: "open_conversation",
      description: "Open a conversation with a simulated seller and return the seller's opening message.",
      params: [{ name: "conversation_id", type: "string", required: true }],
    },
  ],
};

describe("ServerCard", () => {
  it("renders connected server with node label, transport connector, name and tools", () => {
    const html = renderToStaticMarkup(<ServerCard server={server} />);
    expect(html).toContain("Haggle agent");
    expect(html).toContain("stdio");
    expect(html).toContain("haggle-marketplace");
    expect(html).toContain("connected");
    expect(html).toContain('data-testid="tool-send_offer"');
    expect(html).toContain("turn: integer");
    expect(html).toContain("price?: any");
    expect(html).toContain("turn: integer, price?: any");
    expect(html).toContain("conversation_id: string");
    expect(html).toContain("Send a price offer to the seller and wait for their reply.");
    expect(html).toContain("Open a conversation with a simulated seller");
    // each tool renders its full description exactly once (inside <details> body)
    // and its one-liner exactly once (inside <summary>)
    expect((html.match(/<details/g) ?? []).length).toBe(2);
    expect((html.match(/<summary/g) ?? []).length).toBe(2);
    // the full description text is present (inside <details>, not always-visible)
    expect(html).toContain("Open a conversation with a simulated seller and return the seller&#x27;s opening message.");
  });

  it("expands the full description in a details element", () => {
    const html = renderToStaticMarkup(<ServerCard server={server} />);
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("Open a conversation with a simulated seller");
  });

  it("renders off server without a tools list", () => {
    const html = renderToStaticMarkup(<ServerCard server={{ ...server, status: "off", tools: [] }} />);
    expect(html).toContain("Not enabled on this server.");
    expect(html).not.toContain("data-testid=\"server-tools\"");
  });

  it("renders down server without a tools list and uses the down label", () => {
    const html = renderToStaticMarkup(<ServerCard server={{ ...server, status: "down", tools: [] }} />);
    expect(html).toContain("Not responding.");
    expect(html).toContain("not responding");
    expect(html).not.toContain("data-testid=\"server-tools\"");
  });
});
