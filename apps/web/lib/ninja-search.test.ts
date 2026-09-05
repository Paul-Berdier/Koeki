import { describe, expect, it } from "vitest";
import { matchesNinjaQuery } from "./ninja-search";

describe("ninja register search", () => {
  const aoki = { name: "Aoki Hoki", code: "NIN-000041", alias: "La Cigale" };
  it("matches name, code and alias, ignoring accents and case", () => {
    expect(matchesNinjaQuery(aoki, "aoki")).toBe(true);
    expect(matchesNinjaQuery(aoki, "HOKI")).toBe(true);
    expect(matchesNinjaQuery(aoki, "000041")).toBe(true);
    expect(matchesNinjaQuery(aoki, "cigale")).toBe(true);
    expect(matchesNinjaQuery({ name: "Élise Sabaku", code: "NIN-000002", alias: null }, "elise")).toBe(true);
  });
  it("keeps every row for an empty query and rejects unrelated text", () => {
    expect(matchesNinjaQuery(aoki, "   ")).toBe(true);
    expect(matchesNinjaQuery(aoki, "tao")).toBe(false);
  });
});
