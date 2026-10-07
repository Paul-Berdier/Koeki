import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
const guards = vi.hoisted(() => ({ write: vi.fn(async () => ({ userId: "manager", name: "Fixture", roles: ["KOEKI_MANAGER"] })) }));
vi.mock("@/lib/session", () => ({ requireWriteAccess: guards.write, demoMode: false }));
import { assignDossier } from "../app/(app)/equipe/actions";

describe("shared ninja register", () => {
  it("refuses stale assignment forms without assigning a ninja", async () => {
    const form = new FormData();
    form.set("ninjaId", "ninja-fixture"); form.set("assigneeId", "agent-fixture"); form.set("reason", "Old assignment form");
    expect(await assignDossier(form)).toEqual({ error: "Les ninjas n’ont pas d’agent référent. Chaque agent intervient librement sur le registre partagé." });
    expect(guards.write).toHaveBeenCalledWith("team:assign");
  });
  it("does not use assignment scope in the register controller", () => {
    const source = readFileSync(new URL("../app/(app)/ninjas/page.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("assignedToMe");
    expect(source).not.toContain('href="/ninjas?mesDossiers=1"');
  });
});
