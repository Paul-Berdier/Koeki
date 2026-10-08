import { describe, expect, it } from "vitest";
import { readAuthStartForm, sameOriginAuthPost, trustedAuthOrigin } from "./auth-start-guard";

describe("native OAuth initiation guards", () => {
  it("requires an HTTPS configuration in production and allows only loopback HTTP in development", () => {
    expect(trustedAuthOrigin("https://koeki.example/", true)).toBe("https://koeki.example");
    expect(trustedAuthOrigin("http://localhost:3100", false)).toBe("http://localhost:3100");
    for (const value of [undefined, "invalid", "http://localhost:3100", "http://koeki.example", "https://user:password@koeki.example", "https://koeki.example/?redirect=evil", "https://koeki.example/#evil"]) expect(trustedAuthOrigin(value, true)).toBeNull();
    expect(trustedAuthOrigin("http://remote.example", false)).toBeNull();
  });
  it("rejects missing, opaque, cross-origin and same-site-only origins before writes", () => {
    const origin = "https://koeki.example";
    expect(sameOriginAuthPost(new Headers({ Origin: origin }), origin)).toBe(true);
    expect(sameOriginAuthPost(new Headers({ Origin: origin, "Sec-Fetch-Site": "same-origin" }), origin)).toBe(true);
    for (const candidate of ["null", "https://evil.example", `${origin}.evil.example`, `${origin}/`, "http://koeki.example", ""]) expect(sameOriginAuthPost(new Headers({ Origin: candidate }), origin)).toBe(false);
    expect(sameOriginAuthPost(new Headers(), origin)).toBe(false);
    expect(sameOriginAuthPost(new Headers({ Origin: origin, "Sec-Fetch-Site": "cross-site" }), origin)).toBe(false);
  });
  it("limits the body and rejects files, ambiguous fields and unexpected redirect targets", async () => {
    const make = (body: string, type = "application/x-www-form-urlencoded") => new Request("https://koeki.example/api/connexion/discord", { method: "POST", headers: { "content-type": type }, body });
    expect((await readAuthStartForm(make("intent=connexion")))?.get("intent")).toBe("connexion");
    for (const body of ["intent=connexion&intent=invitation", "intent=invitation&token=a&token=b", "intent=connexion&redirectTo=https://evil.example", "intent=invitation&token=" + "x".repeat(3000)]) expect(await readAuthStartForm(make(body))).toBeNull();
    expect(await readAuthStartForm(make("{}", "application/json"))).toBeNull();
  });
});
