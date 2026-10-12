import { type NextRequest, NextResponse } from "next/server";

function createContentSecurityPolicy(nonce: string, isAuthPage: boolean) {
  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : [])
  ];
  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://cdn.discordapp.com",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    ...(process.env.DEMO_MODE === "true" ? [] : ["frame-ancestors 'none'"]),
    "base-uri 'self'",
    // Native form POSTs redirect to the canonical Discord OAuth origin.
    `form-action 'self'${isAuthPage ? " https://discord.com" : ""}`
  ].join("; ");
}

export function middleware(request: NextRequest) {
  // Next 15.5 internally fetches an action's redirect target as RSC, forwarding
  // the x-action-redirect response header to that synthetic GET. In production
  // the combined Flight response can remain pending after the write commits.
  // Decline ONLY this optional inline render. Next keeps its original redirect
  // and performs a fresh document GET (its built-in non-Flight fallback).
  // This header is NOT an authorization signal: a spoofed GET only receives an
  // empty, uncacheable response. POST actions and actual page GETs still execute
  // all existing session, CSRF and permission checks. Never replay a mutation.
  if (process.env.NODE_ENV === "production" && request.method === "GET"
    && request.headers.get("rsc") === "1" && request.headers.has("x-action-redirect")) {
    return new NextResponse(null, { status: 204, headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Vary": "RSC, X-Action-Redirect",
      "X-Content-Type-Options": "nosniff"
    } });
  }

  const nonce = crypto.randomUUID().replaceAll("-", "");
  const isInvitation = request.nextUrl.pathname.startsWith("/invite/");
  const contentSecurityPolicy = createContentSecurityPolicy(nonce, isInvitation || request.nextUrl.pathname === "/connexion");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  if (isInvitation) {
    // Strip the bearer-token path while preserving Origin on native POSTs.
    // no-referrer here would produce Origin:null and correctly fail the CSRF guard.
    // The OAuth 303 response applies no-referrer before leaving the site.
    response.headers.set("Referrer-Policy", "strict-origin");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" }
      ]
    }
  ]
};
