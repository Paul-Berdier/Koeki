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
    // Native form POSTs can redirect to Discord before JS loads (or without JS).
    // Only authentication pages may redirect a form to this canonical OAuth origin.
    `form-action 'self'${isAuthPage ? " https://discord.com" : ""}`
  ].join("; ");
}

export function middleware(request: NextRequest) {
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
    response.headers.set("Referrer-Policy", "no-referrer");
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
