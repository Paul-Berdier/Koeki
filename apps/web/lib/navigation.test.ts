import { describe, expect, it } from "vitest";
import { allowedNavigation } from "./navigation";
describe("navigation by union of permissions", () => {
  it.each(["ECONOMIC_AGENT", "AUDITOR", "NINJA"] as const)("never exposes audit or confidential team for %s", role => {
    expect(allowedNavigation([role])).not.toContain("/audit");
    expect(allowedNavigation([role])).not.toContain("/equipe");
    expect(allowedNavigation([role])).not.toContain("/admin/comptes");
  });
  it("preserves auditor business reads without giving ranking or confidential team",()=>{
    expect(allowedNavigation(["AUDITOR"])).toEqual(expect.arrayContaining(["/statistics","/ninjas","/inventory","/reports"]));
    expect(allowedNavigation(["AUDITOR"])).not.toContain("/classement");
  });
  it("uses all roles regardless of order",()=>{
    expect(allowedNavigation(["NINJA","KOEKI_MANAGER"])).toEqual(allowedNavigation(["KOEKI_MANAGER","NINJA"]));
    expect(allowedNavigation(["NINJA","KOEKI_MANAGER"])).toContain("/audit");
  });
  it("has a collective ranking route outside the manager space",()=>{
    expect(allowedNavigation(["ECONOMIC_AGENT"])).toContain("/classement");
    expect(allowedNavigation(["ECONOMIC_AGENT"])).not.toContain("/equipe");
  });
});
