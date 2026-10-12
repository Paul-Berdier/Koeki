import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

beforeEach(() => { vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("DEMO_MODE", "false"); });
afterEach(() => vi.unstubAllEnvs());
const request = (headers: Record<string, string> = {}, method = "GET", path = "/ninjas/test") =>
  new NextRequest(`https://koeki.example.test${path}`, { method, headers });

describe("post-action document navigation fallback", () => {
  it("declines only the optional synthetic Flight redirect GET", async () => {
    const response = middleware(request({ rsc: "1", "x-action-redirect": "/ninjas/test;push" }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("vary")).toBe("RSC, X-Action-Redirect");
    expect(response.headers.get("content-type")).not.toContain("text/x-component");
    expect(response.headers.get("location")).toBeNull();
  });
  it("never intercepts a real POST mutation, even with forged redirect headers", () => {
    const response = middleware(request({ rsc: "1", "x-action-redirect": "https://untrusted.example/", "next-action": "test" }, "POST"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("content-security-policy")).toContain("'strict-dynamic'");
  });
  it.each([{}, { rsc: "1" }, { "x-action-redirect": "/ninjas/test;push" }])("preserves ordinary page rendering and strict CSP for %o", (headers) => {
    const response = middleware(request(headers));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    const csp = response.headers.get("content-security-policy");
    expect(csp).toContain("'nonce-");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
  });
  it("does not interpret an untrusted redirect value as authority or a destination", async () => {
    const response = middleware(request({ rsc: "1", "x-action-redirect": "https://untrusted.example/" }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("leaves development rendering unchanged", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(middleware(request({ rsc: "1", "x-action-redirect": "/ninjas/test;push" })).headers.get("x-middleware-next")).toBe("1");
  });
});
