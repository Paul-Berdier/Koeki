import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session", () => ({ demoMode: false, hasPermission: (session: { roles: string[] }) => session.roles.includes("KOEKI_MANAGER") }));
import { getAgentTaxLedger, taxBucket } from "./agent-tax-ledger";

const payment = { status: "VALIDATED", operationOrigin: "BUSINESS", method: "RYO", validatedAt: new Date("2026-10-06T12:00:00Z") };
describe("agent tax journal", () => {
  it("counts cash independently of any ninja reference agent", () => {
    expect(taxBucket(payment)).toBe("collected");
  });
  it.each(["UNKNOWN", "IMPORT", "LEGACY"])("separates attributed history with %s origin", (origin) => {
    expect(taxBucket({ ...payment, operationOrigin: origin })).toBe("history");
  });
  it.each(["EXEMPTION", "EXEMPTION_CREDIT", "DONATION"])("never treats %s as cash", (method) => {
    expect(taxBucket({ ...payment, method })).toBe("excluded");
  });
  it.each(["PENDING", "CANCELLED", "REVERSED"])("excludes %s receipts", (status) => {
    expect(taxBucket({ ...payment, status })).toBe("excluded");
  });
  it("does not fabricate a validation date", () => {
    expect(taxBucket({ ...payment, validatedAt: null })).toBe("excluded");
  });
  it("rejects an ordinary agent before reading the database", async () => {
    await expect(getAgentTaxLedger({ userId: "fixture", name: "Agent", roles: ["ECONOMIC_AGENT"] })).rejects.toThrow("FORBIDDEN");
  });
});
