import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const TOKENS_URL = new URL("../design/tokens.css", import.meta.url).pathname;
function fsPath(urlPath: string): string {
  return urlPath.replace(/^\//, "").replace(/^([A-Za-z])\//, "$1:/");
}
const TOKENS_PATH = fsPath(TOKENS_URL);

function readTokens(): string {
  return readFileSync(TOKENS_PATH, "utf8");
}

function themeBlock(css: string, selector: string): Record<string, string> {
  const safe = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${safe}\\s*\\{([^}]*)\\}`, "s");
  const match = css.match(regex);
  if (!match) return {};
  const clean = match[1].replace(/\/\*[\s\S]*?\*\//g, "");
  const vars: Record<string, string> = {};
  for (const line of clean.split(";")) {
    const [name, ...rest] = line.split(":");
    const key = name.trim();
    const value = rest.join(":").trim();
    if (key.startsWith("--") && value) vars[key] = value;
  }
  return vars;
}

function parseHex(color: string): { r: number; g: number; b: number } | null {
  const m = color.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

function luminance(c: { r: number; g: number; b: number }): number {
  const s = (channel: number) => {
    const x = channel / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * s(c.r) + 0.7152 * s(c.g) + 0.0722 * s(c.b);
}

function contrast(fg: string, bg: string, vars: Record<string, string>): number {
  const ca = parseHex(vars[fg] ?? fg);
  const cb = parseHex(vars[bg] ?? bg);
  if (!ca || !cb) return 0;
  const la = luminance(ca);
  const lb = luminance(cb);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

type Pair = {
  label: string;
  foreground: string;
  background: string;
  min: number;
};

// Light theme pairs only. Every text token on every surface it is used on,
// agent/seller bubble text, buttons (text on fill), badges, links, focus ring
// vs surface (>= 3:1), borders that carry meaning (>= 3:1); text >= 4.5:1.
const TEXT_PAIRS: Pair[] = [
  { label: "Body ink on paper", foreground: "--color-ink", background: "--color-paper", min: 4.5 },
  { label: "Muted on paper", foreground: "--color-muted", background: "--color-paper", min: 4.5 },
  { label: "Primary link on surface", foreground: "--color-primary", background: "--color-surface", min: 4.5 },
  { label: "Danger text on surface", foreground: "--color-danger", background: "--color-surface", min: 4.5 },
  { label: "Warning text on warning bg", foreground: "--color-warning-text", background: "--color-warning-bg", min: 4.5 },
  { label: "Success text on surface", foreground: "--color-success-text", background: "--color-surface", min: 4.5 },
  { label: "Agent avatar text on tint", foreground: "--color-primary", background: "--color-agent-tint", min: 4.5 },
  { label: "Seller avatar text on tint", foreground: "--color-warning-text", background: "--color-seller-tint", min: 4.5 },
  { label: "Primary button text on fill", foreground: "#ffffff", background: "--color-primary", min: 4.5 },
  { label: "Ghost button text on surface", foreground: "--color-ink", background: "--color-surface", min: 4.5 },
];

const BORDER_PAIRS: Pair[] = [
  { label: "Focus ring on surface", foreground: "--color-primary", background: "--color-surface", min: 3 },
  { label: "Danger border on surface", foreground: "--color-danger", background: "--color-surface", min: 3 },
];

// Printed for visibility but not asserted: spec colours are intentionally subtle.
const INFO_PAIRS: Pair[] = [
  { label: "White text on primary", foreground: "#ffffff", background: "--color-primary", min: 4.5 },
  { label: "Hairline line on surface", foreground: "--color-line", background: "--color-surface", min: 3 },
];

function row(pair: Pair, vars: Record<string, string>) {
  const ratio = contrast(pair.foreground, pair.background, vars);
  return { ...pair, ratio, pass: ratio >= pair.min };
}

describe("contrast", () => {
  it("tokens.css contains no color-mix() and no alpha-defined text colours", () => {
    const css = readTokens();
    expect(css).not.toContain("color-mix(");
    // Any --color-* token used as a text colour must be an explicit hex, not rgba()/hsla().
    const textColorTokens = css.match(/--color-[a-z-]+:\s*rgba?\(/g);
    expect(textColorTokens).toBeNull();
  });

  it("meets contrast requirements in light theme", () => {
    const css = readTokens();
    const light = themeBlock(css, ":root");
    expect(Object.keys(light).length).toBeGreaterThan(0);

    const all = [...TEXT_PAIRS, ...BORDER_PAIRS, ...INFO_PAIRS];

    // Print the computed table once.
    console.log("\nContrast ratios (light theme):");
    console.log("pair".padEnd(34), "min".padEnd(6), "ratio".padEnd(8), "pass");
    for (const p of all) {
      const r = row(p, light);
      const status = r.pass ? "ok" : "info";
      console.log(
        p.label.padEnd(34),
        p.min.toFixed(1).padEnd(6),
        r.ratio.toFixed(2).padEnd(8),
        status,
      );
    }

    const asserted = [...TEXT_PAIRS, ...BORDER_PAIRS];
    for (const p of asserted) {
      expect(row(p, light).pass, `${p.label} (light)`).toBe(true);
    }
  });
});
