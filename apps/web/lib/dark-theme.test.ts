import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/styles/dark.css", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function colour(name: string): string {
  const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, "i"))?.[1];
  if (!value) throw new Error(`Missing literal colour token: ${name}`);
  return value;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(colour(foreground));
  const b = luminance(colour(background));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("dark theme", () => {
  it("loads the dark colour layer last and declares native dark controls", () => {
    expect(globals.trim().endsWith('@import "./styles/dark.css";')).toBe(true);
    expect(css).toContain("color-scheme: dark;");
  });

  it.each(["canvas", "surface", "surface-muted", "surface-hover", "surface-raised"])("keeps primary and secondary text readable on %s", (background) => {
    expect(contrast("text", background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("text-secondary", background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("accent", background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["success", "success-soft"],
    ["warning", "warning-soft"],
    ["danger", "danger-soft"],
    ["action-text", "action"],
    ["action-text", "action-hover"],
  ])("keeps %s text readable on %s", (foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps input boundaries and keyboard focus visible", () => {
    expect(contrast("border-strong", "canvas")).toBeGreaterThanOrEqual(3);
    expect(contrast("border-strong", "surface")).toBeGreaterThanOrEqual(3);
    expect(css).toContain("outline: 3px solid var(--accent)");
  });
});
