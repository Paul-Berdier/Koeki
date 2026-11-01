import { expect, it, vi } from "vitest";
import { prisma } from "@koeki/database";
import { listNinjaOptions } from "./inventory-data";

vi.mock("./session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session")>()),
  demoMode: true,
}));

it("opens the demo movement drawer without reading real ninja identities", async () => {
  const findNinjas = vi
    .spyOn(prisma.ninjaProfile, "findMany")
    .mockRejectedValue(new Error("The demo must work without a database"));
  try {
    await expect(listNinjaOptions()).resolves.toEqual([
      { id: "demo-41", name: "Aoki Hoki", code: "NIN-000041" },
      { id: "demo-58", name: "Araki Hoki", code: "NIN-000058" },
      { id: "demo-63", name: "Inao Hoki", code: "NIN-000063" },
      { id: "demo-94", name: "Tao Hoki", code: "NIN-000094" },
    ]);
    expect(findNinjas).not.toHaveBeenCalled();
  } finally {
    findNinjas.mockRestore();
  }
});
