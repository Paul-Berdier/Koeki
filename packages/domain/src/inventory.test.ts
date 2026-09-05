import { describe, expect, it } from "vitest";
import {
  addQuantities, buildCsv, checkAvailability, counterpartyRoleLabel, csvEscape, deriveStockState, directionOfQuantity,
  formatQuantityWithUnit, formatSignedQuantity, normalizeSearch, parseQuantityInput, planStocktake, subtractQuantities, suggestResourceCode
} from "./inventory";
import { can } from "./permissions";

describe("stock state", () => {
  it("never reads a resource that was never counted as a stock level", () => {
    expect(deriveStockState({ inventoryStatus: "NOT_INVENTORIED", quantity: 0, minimumStock: 10, criticalStock: 5 })).toBe("NOT_INVENTORIED");
    expect(deriveStockState({ inventoryStatus: "NOT_INVENTORIED", quantity: 500, minimumStock: 10, criticalStock: 5 })).toBe("NOT_INVENTORIED");
  });
  it("distinguishes a real zero from a missing count", () => {
    expect(deriveStockState({ inventoryStatus: "COUNTED", quantity: 0, minimumStock: 0, criticalStock: 0 })).toBe("OUT_OF_STOCK");
  });
  it("applies critical before low and ignores unset thresholds", () => {
    expect(deriveStockState({ inventoryStatus: "COUNTED", quantity: 15, minimumStock: 100, criticalStock: 20 })).toBe("CRITICAL");
    expect(deriveStockState({ inventoryStatus: "COUNTED", quantity: 45, minimumStock: 100, criticalStock: 20 })).toBe("LOW");
    expect(deriveStockState({ inventoryStatus: "COUNTED", quantity: 520, minimumStock: 100, criticalStock: 20 })).toBe("NORMAL");
    expect(deriveStockState({ inventoryStatus: "COUNTED", quantity: 1, minimumStock: 0, criticalStock: 0 })).toBe("NORMAL");
  });
});

describe("quantities", () => {
  it("parses French decimals within the unit precision", () => {
    expect(parseQuantityInput("12,5", 3, "kg")).toEqual({ ok: true, value: 12.5 });
    expect(parseQuantityInput(" 1 250 ", 0)).toEqual({ ok: true, value: 1250 });
    expect(parseQuantityInput("12.5", 0, "unité")).toMatchObject({ ok: false });
    expect(parseQuantityInput("1.23456", 4)).toMatchObject({ ok: false });
    expect(parseQuantityInput("-5", 0)).toMatchObject({ ok: false });
    expect(parseQuantityInput("", 0)).toMatchObject({ ok: false });
    expect(parseQuantityInput("abc", 0)).toMatchObject({ ok: false });
  });
  it("adds and subtracts without floating point drift", () => {
    expect(addQuantities(0.1, 0.2)).toBe(0.3);
    expect(subtractQuantities(520, 0.0001)).toBe(519.9999);
  });
  it("formats with the unit and a typographic sign", () => {
    expect(formatQuantityWithUnit(495, { label: "kg", decimals: 3 })).toBe("495 kg");
    expect(formatSignedQuantity(-25, { label: "kg", decimals: 3 })).toBe("−25 kg");
    expect(formatSignedQuantity(50, { label: "unité", decimals: 0 })).toBe("+50 unité");
  });
  it("labels the counterparty according to the direction", () => {
    expect(directionOfQuantity(-3)).toBe("out");
    expect(counterpartyRoleLabel(-3)).toBe("Pris par");
    expect(counterpartyRoleLabel(3)).toBe("Donné par");
  });
});

describe("availability", () => {
  it("refuses a negative stock by default and reports what is available", () => {
    expect(checkAvailability({ current: 10, delta: -15, allowNegative: false })).toEqual({ ok: false, next: -5, available: 10, requested: 15 });
    expect(checkAvailability({ current: 10, delta: -10, allowNegative: false })).toEqual({ ok: true, next: 0 });
    expect(checkAvailability({ current: 10, delta: -15, allowNegative: true })).toEqual({ ok: true, next: -5 });
  });
});

describe("stocktake planning", () => {
  it("writes an initial balance for a first count, even at zero", () => {
    const [iron, wool] = planStocktake([
      { resourceId: "iron", inventoryStatus: "NOT_INVENTORIED", expected: 10, counted: 520 },
      { resourceId: "wool", inventoryStatus: "NOT_INVENTORIED", expected: 0, counted: 0 }
    ]);
    expect(iron).toMatchObject({ difference: 510, movementType: "INITIAL_BALANCE" });
    expect(wool).toMatchObject({ difference: 0, movementType: "INITIAL_BALANCE" });
  });
  it("turns later differences into signed adjustments and skips exact counts", () => {
    const lines = planStocktake([
      { resourceId: "iron", inventoryStatus: "COUNTED", expected: 520, counted: 500 },
      { resourceId: "copper", inventoryStatus: "COUNTED", expected: 190, counted: 195 },
      { resourceId: "plan", inventoryStatus: "COUNTED", expected: 80, counted: 80 }
    ]);
    expect(lines.map((line) => [line.difference, line.movementType])).toEqual([[-20, "ADJUSTMENT_OUT"], [5, "ADJUSTMENT_IN"], [0, null]]);
  });
});

describe("csv and search", () => {
  it("quotes separators and newlines, keeps a BOM for spreadsheets", () => {
    expect(csvEscape('Fer; "brut"')).toBe('"Fer; ""brut"""');
    expect(buildCsv(["a", "b"], [["x", 1], ["y;z", null]])).toBe("﻿a;b\r\nx;1\r\n\"y;z\";\r\n");
  });
  it("neutralises spreadsheet formulas in free text but keeps signed numbers", () => {
    expect(csvEscape('=HYPERLINK("http://evil/","x")')).toBe('"\'=HYPERLINK(""http://evil/"",""x"")"');
    expect(csvEscape("+33 6")).toBe("'+33 6");
    expect(csvEscape("@Aoki")).toBe("'@Aoki");
    expect(csvEscape(-25)).toBe("-25");
    expect(csvEscape("Fer")).toBe("Fer");
  });
  it("ignores accents and case when searching", () => {
    expect(normalizeSearch("  Pièces Chakra ")).toBe("pieces chakra");
    expect(suggestResourceCode("Pièces Chakra")).toBe("RES-PIECES-CHAKRA");
  });
});

describe("inventory permissions", () => {
  it("lets a plain agent see, move and export but not count, adjust or manage the catalog", () => {
    expect(can("ECONOMIC_AGENT", "inventory:read")).toBe(true);
    expect(can("ECONOMIC_AGENT", "inventory:write")).toBe(true);
    expect(can("ECONOMIC_AGENT", "inventory:export")).toBe(true);
    expect(can("ECONOMIC_AGENT", "inventory:count")).toBe(false);
    expect(can("ECONOMIC_AGENT", "inventory:adjust")).toBe(false);
    expect(can("ECONOMIC_AGENT", "inventory:catalog")).toBe(false);
  });
  it("gives managers and super-administrators every inventory capability", () => {
    for (const role of ["SUPER_ADMIN", "KOEKI_MANAGER"] as const) {
      for (const permission of ["inventory:read", "inventory:write", "inventory:count", "inventory:adjust", "inventory:catalog", "inventory:export"] as const) expect(can(role, permission)).toBe(true);
    }
  });
  it("keeps auditors read-only and ninjas out", () => {
    expect(can("AUDITOR", "inventory:read")).toBe(true);
    expect(can("AUDITOR", "inventory:write")).toBe(false);
    expect(can("NINJA", "inventory:read")).toBe(false);
  });
});
